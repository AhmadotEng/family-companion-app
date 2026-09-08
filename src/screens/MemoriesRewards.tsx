import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Bot,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Eye,
  FileAudio,
  FileVideo,
  Gift,
  Image as ImageIcon,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  NotebookPen,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ApiError } from '../api/client';
import {
  fetchMemoryMedia,
  MAX_MEMORY_UPLOAD_BYTES,
  MEMORY_MEDIA_TYPES,
  memoriesRewardsApi,
  uploadMemoryMedia,
  validateMemoryDraft,
  validateMemoryFile,
  type CreateMemoryDraft,
  type MemoryType,
  type MemoryVisibility
} from '../api/memoriesRewards';
import type { MemoryRecord, PersistentGathering, RewardOffer, RewardSummary } from '../engagementTypes';
import { cn } from '../lib/utils';

type FamilyPerson = {
  id: string;
  name?: string;
  displayName?: string;
};

interface MemoriesRewardsProps {
  familyId: string;
  familyRole?: string;
  currentUserId?: string;
  members: FamilyPerson[];
  refreshVersion?: number;
  requestedView?: 'memories' | 'rewards';
  viewRequestVersion?: number;
}

interface PendingUpload {
  memoryId: string;
  uploadPath: string;
  file: File;
  memoryType: Exclude<MemoryType, 'note'>;
}

const blankRewards: RewardSummary = { balance: 0, entries: [], offers: [] };

interface AlbumMemory {
  id: string;
  title: string;
  note: string;
  capturedAt: string;
  gatheringId: string;
  memoryType: MemoryType;
  image?: string;
}

interface MemoryAlbum {
  id: string;
  title: string;
  date: string;
  location: string;
  cover: string;
  memories: AlbumMemory[];
}

const demoAlbums: MemoryAlbum[] = [
  {
    id: 'demo-qasr',
    title: 'Grandparents’ Day at Qasr Al Hosn',
    date: '18 January 2026',
    location: 'Qasr Al Hosn, Abu Dhabi',
    cover: '/assets/activity-qasr-al-hosn.png',
    memories: [{
      id: 'demo-qasr-photo',
      title: 'Three generations together',
      note: 'Grandfather showed the children where Abu Dhabi’s story began, then shared memories from his childhood.',
      capturedAt: '2026-01-18T16:30:00+04:00',
      gatheringId: 'demo-qasr',
      memoryType: 'photo',
      image: '/assets/activity-qasr-al-hosn.png',
    }],
  },
  {
    id: 'demo-louvre',
    title: 'Family Museum Morning',
    date: '12 April 2026',
    location: 'Louvre Abu Dhabi',
    cover: '/assets/activity-louvre-abu-dhabi.png',
    memories: [{
      id: 'demo-louvre-photo',
      title: 'Under the dome',
      note: 'Everyone chose one artwork to remember. The children loved the moving patterns of light most of all.',
      capturedAt: '2026-04-12T11:00:00+04:00',
      gatheringId: 'demo-louvre',
      memoryType: 'photo',
      image: '/assets/activity-louvre-abu-dhabi.png',
    }],
  },
  {
    id: 'demo-noor',
    title: 'Cousins’ Picnic',
    date: '24 May 2026',
    location: 'Al Noor Island, Sharjah',
    cover: '/assets/activity-al-noor-island.png',
    memories: [{
      id: 'demo-noor-photo',
      title: 'A long afternoon together',
      note: 'A simple picnic turned into hours of stories, games and plans for the next family day.',
      capturedAt: '2026-05-24T16:00:00+04:00',
      gatheringId: 'demo-noor',
      memoryType: 'photo',
      image: '/assets/activity-al-noor-island.png',
    }],
  },
];

const demoGatheringNames = new Map(demoAlbums.map(album => [album.id, album.title]));

const memoryTypeOptions: Array<{
  value: MemoryType;
  label: string;
  detail: string;
  icon: typeof NotebookPen;
}> = [
  { value: 'note', label: 'Written', detail: 'Preserve a family story', icon: NotebookPen },
  { value: 'photo', label: 'Photo', detail: 'JPEG, PNG or WebP', icon: Camera },
  { value: 'video', label: 'Video', detail: 'MP4, up to 15 MB', icon: FileVideo },
  { value: 'audio', label: 'Audio', detail: 'MP3, M4A or WebM', icon: FileAudio }
];

const visibilityCopy: Record<MemoryVisibility, { label: string; detail: string }> = {
  private: { label: 'Only me', detail: 'Only the person saving this memory can open it.' },
  family_admin: { label: 'Family administrators', detail: 'You and family owners or administrators can view it.' },
  family: { label: 'Whole family', detail: 'Every signed-in member of this family can view it.' },
  selected: { label: 'Selected family members', detail: 'Only you and the people selected below can view it.' }
};

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(document.documentElement.lang === 'ar' ? 'ar-AE' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function readableBytes(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function personName(person: FamilyPerson): string {
  return person.displayName || person.name || 'Family member';
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function MemoryMedia({ memory }: { memory: MemoryRecord }) {
  const [objectUrl, setObjectUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextUrl = await fetchMemoryMedia(memory.id);
      setObjectUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    } catch (caught) {
      setError(errorMessage(caught, 'This media could not be opened.'));
    } finally {
      setLoading(false);
    }
  };

  if (!memory.hasMedia) {
    return (
      <div className="rounded-2xl border border-dashed border-sepia bg-sand/60 p-4 text-xs text-ink/50">
        The memory record exists, but no media file has been uploaded.
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-sepia bg-sand/60 px-4 py-2.5 text-xs font-semibold text-ink/60 hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:cursor-wait"
        >
          {loading ? <LoaderCircle className="animate-spin" size={16} /> : <Eye size={16} />}
          {loading ? 'Opening private media…' : `Open ${memory.memoryType}`}
        </button>
        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  if (memory.memoryType === 'photo') {
    return <img src={objectUrl} alt={memory.title} className="max-h-96 w-full rounded-2xl bg-ink/5 object-contain" />;
  }
  if (memory.memoryType === 'video') {
    return <video src={objectUrl} controls preload="metadata" className="max-h-96 w-full rounded-2xl bg-ink" aria-label={memory.title} />;
  }
  return <audio src={objectUrl} controls preload="metadata" className="w-full" aria-label={memory.title} />;
}

function MemoryCard({
  memory,
  gatheringTitle,
  canDelete,
  deleting,
  onDelete,
}: {
  memory: MemoryRecord;
  gatheringTitle?: string;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const TypeIcon = memory.memoryType === 'note'
    ? NotebookPen
    : memory.memoryType === 'photo'
      ? ImageIcon
      : memory.memoryType === 'video'
        ? FileVideo
        : FileAudio;

  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-sepia bg-white p-4 shadow-sm sm:space-y-5 sm:rounded-[2rem] sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold sm:size-11 sm:rounded-2xl"><TypeIcon size={20} aria-hidden="true" /></div>
          <div className="min-w-0">
            <h4 className="break-words font-serif text-lg font-bold text-ink sm:text-xl">{memory.title}</h4>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/45">
              <Clock3 size={12} aria-hidden="true" /> {readableDate(memory.capturedAt)}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-sepia px-3 py-1.5 text-[11px] font-semibold text-ink/55">
          {visibilityCopy[memory.visibility].label}
        </span>
      </div>

      {gatheringTitle && (
        <p className="flex items-center gap-2 text-xs font-semibold text-gold-ink">
          <CalendarDays size={14} aria-hidden="true" /> {gatheringTitle}
        </p>
      )}
      {memory.note && <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink/70">{memory.note}</p>}
      {memory.memoryType !== 'note' && <MemoryMedia memory={memory} />}

      <div className="flex flex-wrap items-center gap-2 border-t border-sepia/60 pt-3 text-[11px] text-ink/45 sm:gap-3 sm:pt-4">
        <span>{memory.memoryType}</span>
        {memory.mediaSizeBytes !== undefined && <span>• {readableBytes(memory.mediaSizeBytes)}</span>}
        <span className="flex items-center gap-1">
          • <Bot size={11} /> AI processing {memory.aiProcessingAllowed ? 'allowed' : 'not allowed'}
        </span>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50"
          >
            {deleting ? <LoaderCircle className="animate-spin" size={12} /> : <Trash2 size={12} />} Delete permanently
          </button>
        )}
      </div>
    </article>
  );
}

function RewardOfferCard({
  offer,
  role,
  redeeming,
  onRedeem
}: {
  offer: RewardOffer;
  role?: string;
  redeeming: boolean;
  onRedeem: (offer: RewardOffer) => void;
}) {
  const canAdminister = role === 'owner' || role === 'admin';
  const enabled = !offer.isDemo && offer.redeemable && canAdminister && !redeeming;
  let buttonText = `${offer.pointsCost.toLocaleString()} points`;
  if (offer.isDemo) buttonText = 'Demo only';
  else if (!canAdminister) buttonText = 'Admin required';
  else if (!offer.redeemable) buttonText = 'Not enough points';
  else if (redeeming) buttonText = 'Submitting…';
  else buttonText = `Redeem ${offer.pointsCost.toLocaleString()}`;

  return (
    <article className={cn(
      'rounded-2xl border p-4 sm:p-5',
      offer.isDemo ? 'border-dashed border-sepia bg-sand/50' : 'border-sepia bg-white'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif font-bold text-ink">{offer.title}</h4>
            {offer.isDemo && (
              <span className="rounded-full bg-ink/5 px-2 py-1 text-[11px] font-semibold text-ink/50">Prototype example</span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">{offer.description}</p>
          {offer.partnerName && <p className="mt-2 text-[11px] font-semibold text-ink/45">Partner: {offer.partnerName}</p>}
        </div>
        <Gift className="shrink-0 text-gold" size={22} />
      </div>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => onRedeem(offer)}
        className="mt-4 min-h-11 w-full rounded-xl bg-ink px-4 text-xs font-semibold text-white hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/35 sm:mt-5"
      >
        {buttonText}
      </button>
      {offer.isDemo && <p className="mt-2 text-center text-[11px] text-ink/45">No voucher or partner connection exists for this example.</p>}
    </article>
  );
}

export function MemoriesRewards({
  familyId,
  familyRole,
  currentUserId,
  members,
  refreshVersion = 0,
  requestedView,
  viewRequestVersion = 0,
}: MemoriesRewardsProps) {
  const [view, setView] = useState<'memories' | 'rewards'>(requestedView ?? 'memories');

  useEffect(() => {
    if (requestedView) setView(requestedView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequestVersion]);
  const [gatherings, setGatherings] = useState<PersistentGathering[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [localMemories, setLocalMemories] = useState<AlbumMemory[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<MemoryAlbum | null>(null);
  const [rewards, setRewards] = useState<RewardSummary>(blankRewards);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [gatheringId, setGatheringId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [memoryType, setMemoryType] = useState<MemoryType>('note');
  const [visibility, setVisibility] = useState<MemoryVisibility>('private');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [aiProcessingAllowed, setAiProcessingAllowed] = useState(false);
  const [capturedAt, setCapturedAt] = useState(localDateTimeValue);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [redeemingId, setRedeemingId] = useState('');
  const [deletingMemoryId, setDeletingMemoryId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const localMemoryStorageKey = `ailah-demo-memories:${familyId}`;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(localMemoryStorageKey);
      const parsed = stored ? JSON.parse(stored) as AlbumMemory[] : [];
      setLocalMemories(Array.isArray(parsed) ? parsed : []);
    } catch {
      setLocalMemories([]);
    }
  }, [localMemoryStorageKey]);

  const loadData = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      const [gatheringResponse, memoryResponse, rewardResponse] = await Promise.all([
        memoriesRewardsApi.listGatherings(familyId),
        memoriesRewardsApi.listMemories(familyId),
        memoriesRewardsApi.getRewards(familyId)
      ]);
      if (version !== requestVersion.current) return;
      const completedGatherings = gatheringResponse.gatherings.filter(gathering => gathering.status === 'completed');
      setGatherings(completedGatherings);
      setMemories(memoryResponse.memories);
      setRewards(rewardResponse);
      setGatheringId(previous => previous || completedGatherings[0]?.id || demoAlbums[0].id);
    } catch (caught) {
      if (version === requestVersion.current) {
        setLoadError(errorMessage(caught, 'Memories and rewards could not be loaded.'));
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [familyId]);

  useEffect(() => {
    setPendingUpload(null);
    setSuccess('');
    setGatheringId(demoAlbums[0].id);
    void loadData();
    return () => {
      requestVersion.current += 1;
    };
  }, [loadData, refreshVersion]);

  const gatheringNames = useMemo(() => new Map(gatherings.map(item => [item.id, item.title])), [gatherings]);
  const acceptedMimeTypes = memoryType === 'note' ? '' : MEMORY_MEDIA_TYPES[memoryType].join(',');

  const resetForm = () => {
    setTitle('');
    setNote('');
    setMemoryType('note');
    setVisibility('private');
    setSelectedMemberIds([]);
    setAiProcessingAllowed(false);
    setCapturedAt(localDateTimeValue());
    setFile(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const refreshMemoriesAndRewards = async () => {
    const [memoryResponse, rewardResponse] = await Promise.all([
      memoriesRewardsApi.listMemories(familyId),
      memoriesRewardsApi.getRewards(familyId)
    ]);
    setMemories(memoryResponse.memories);
    setRewards(rewardResponse);
  };

  const runUpload = async (upload: PendingUpload) => {
    setSaving(true);
    setFormError('');
    setUploadProgress(0);
    try {
      await uploadMemoryMedia(upload.uploadPath, upload.file, upload.memoryType, progress => {
        setUploadProgress(progress.percent);
      });
      setPendingUpload(null);
      setSuccess('The private media file was uploaded and the memory is now complete.');
      await refreshMemoriesAndRewards();
    } catch (caught) {
      setFormError(
        `${errorMessage(caught, 'The media upload failed.')} The memory record was saved, but it has no media yet. Retry below; do not create a duplicate.`
      );
      await memoriesRewardsApi.listMemories(familyId).then(response => setMemories(response.memories)).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const saveMemory = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    if (!gatheringId) {
      setFormError('Create and select a persisted gathering before adding a memory.');
      return;
    }
    const capturedDate = new Date(capturedAt);
    const draft: CreateMemoryDraft = {
      familyId,
      title,
      note,
      memoryType,
      visibility,
      selectedMemberIds,
      aiProcessingAllowed,
      capturedAt: Number.isNaN(capturedDate.getTime()) ? capturedAt : capturedDate.toISOString()
    };
    const validationError = validateMemoryDraft(draft, file);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (demoGatheringNames.has(gatheringId)) {
      if (file && file.size > 3 * 1024 * 1024) {
        setFormError('For this demo album, choose a file smaller than 3 MB.');
        return;
      }
      setSaving(true);
      try {
        const savedMemory: AlbumMemory = {
          id: crypto.randomUUID(),
          title: title.trim(),
          note: note.trim(),
          capturedAt: draft.capturedAt,
          gatheringId,
          memoryType,
          ...(file ? { image: await fileToDataUrl(file) } : {}),
        };
        const nextMemories = [savedMemory, ...localMemories];
        window.localStorage.setItem(localMemoryStorageKey, JSON.stringify(nextMemories));
        setLocalMemories(nextMemories);
        resetForm();
        setFormOpen(false);
        setSuccess('Your memory was saved and added to the family album.');
      } catch (caught) {
        setFormError(errorMessage(caught, 'The memory could not be saved on this device.'));
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const created = await memoriesRewardsApi.createMemory(gatheringId, draft);
      if (memoryType === 'note') {
        resetForm();
        setFormOpen(false);
        setSuccess('The written memory was saved with the selected privacy setting.');
        await refreshMemoriesAndRewards();
        return;
      }
      if (!created.uploadPath || !file) {
        throw new ApiError('The memory record was created, but the server did not provide a media upload path.', 0, 'UPLOAD_PATH_MISSING');
      }
      const upload: PendingUpload = { memoryId: created.memory.id, uploadPath: created.uploadPath, file, memoryType };
      setPendingUpload(upload);
      resetForm();
      setFormOpen(false);
      await runUpload(upload);
    } catch (caught) {
      setFormError(errorMessage(caught, 'The memory could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const selectMemoryType = (nextType: MemoryType) => {
    setMemoryType(nextType);
    setFile(null);
    setFormError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleViewer = (memberId: string) => {
    setSelectedMemberIds(previous => (
      previous.includes(memberId) ? previous.filter(id => id !== memberId) : [...previous, memberId]
    ));
  };

  const redeem = async (offer: RewardOffer) => {
    if (offer.isDemo || !offer.redeemable || (familyRole !== 'owner' && familyRole !== 'admin')) return;
    if (!window.confirm(`Use ${offer.pointsCost.toLocaleString()} family points for “${offer.title}”?`)) return;
    setRedeemingId(offer.id);
    setLoadError('');
    setSuccess('');
    try {
      const response = await memoriesRewardsApi.redeemReward(familyId, offer.id);
      setSuccess(`Redemption ${response.redemption.id} was recorded as pending. This does not claim that a voucher was delivered.`);
      setRewards(await memoriesRewardsApi.getRewards(familyId));
    } catch (caught) {
      setLoadError(errorMessage(caught, 'The reward could not be redeemed.'));
    } finally {
      setRedeemingId('');
    }
  };

  const deleteMemory = async (memory: MemoryRecord) => {
    if (!window.confirm(`Permanently delete “${memory.title}” and its private media file? This cannot be undone.`)) return;
    setDeletingMemoryId(memory.id);
    setLoadError('');
    setSuccess('');
    try {
      await memoriesRewardsApi.deleteMemory(memory.id);
      setMemories(previous => previous.filter(item => item.id !== memory.id));
      setSuccess('The memory record and stored media were permanently deleted.');
    } catch (caught) {
      setLoadError(errorMessage(caught, 'The memory could not be deleted.'));
    } finally {
      setDeletingMemoryId('');
    }
  };

  const personalAlbum: MemoryAlbum | null = localMemories.length ? {
    id: 'my-added-memories',
    title: 'My added memories',
    date: 'Saved on this device',
    location: 'Family album',
    cover: localMemories.find(memory => memory.image)?.image || '/assets/ailah-mark.png',
    memories: localMemories,
  } : null;

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-sepia bg-white sm:min-h-72 sm:rounded-[2rem]">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-gold" size={28} />
          <p className="mt-3 font-serif text-ink/60">Opening the private family archive…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-7">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => void loadData(true)}
          disabled={refreshing}
          aria-label="Refresh archive"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink/50 hover:bg-white hover:text-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink disabled:cursor-wait sm:w-auto sm:gap-2 sm:px-3 sm:text-xs sm:font-semibold"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" /> <span className="sr-only sm:not-sr-only">Refresh</span>
        </button>
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 shrink-0" size={18} /> <span>{loadError}</span>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <Check className="mt-0.5 shrink-0" size={18} /> <span>{success}</span>
        </div>
      )}
      {formError && !formOpen && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle className="mt-0.5 shrink-0" size={18} /> <span>{formError}</span>
        </div>
      )}

      {view === 'memories' ? (
        <>
          <section className="overflow-hidden rounded-3xl border border-sepia bg-white p-5 shadow-sm sm:rounded-[2rem] sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-gold-ink">Private family archive</p>
                <h3 className="mt-1 font-serif text-xl font-bold sm:text-2xl">Your family memories, gathered by occasion.</h3>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(open => !open)}
                disabled={Boolean(pendingUpload)}
                aria-label={formOpen ? 'Close form' : 'Add memory'}
                title={formOpen ? 'Close form' : 'Add memory'}
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ink text-white shadow-lg transition-transform hover:scale-105 hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {formOpen ? <X size={22} /> : <Plus size={24} />}
              </button>
            </div>
          </section>

          <section className="space-y-3 sm:space-y-4" aria-labelledby="previous-memories-heading">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 id="previous-memories-heading" className="font-serif text-xl font-bold sm:text-2xl">Previous memories</h3>
                <p className="mt-1 text-sm text-ink/65">Open an album to revisit the photos and stories.</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-gold-ink">{`${demoAlbums.length + (personalAlbum ? 1 : 0)} albums`}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {[...(personalAlbum ? [personalAlbum] : []), ...demoAlbums].map(album => (
                <button key={album.id} type="button" onClick={() => setSelectedAlbum(album)} className="group overflow-hidden rounded-2xl border border-sepia bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-gold hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:rounded-3xl">
                  <div className="relative h-40 overflow-hidden bg-sand sm:h-44">
                    <img src={album.cover} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    <span className="absolute bottom-3 right-3 rounded-full bg-ink/80 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">{`${album.memories.length} ${album.memories.length === 1 ? 'memory' : 'memories'}`}</span>
                  </div>
                  <div className="p-4">
                    <h4 className="line-clamp-1 font-serif text-lg font-bold text-ink">{album.title}</h4>
                    <p className="mt-1 text-xs font-medium text-ink/65">{album.date}</p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/65"><MapPin size={13} className="text-gold" /> {album.location}</p>
                    <span className="mt-3 inline-flex text-xs font-bold text-gold-ink">View album</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {pendingUpload && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <Upload className="mt-0.5 shrink-0 text-amber-700" size={20} />
                <div className="flex-1">
                  <h3 className="font-serif font-bold text-amber-950">Media upload still required</h3>
                  <p className="mt-1 text-xs leading-relaxed text-amber-900/75">
                    The memory record is saved, but its file is not. Retry the same file to complete it.
                  </p>
                  {uploadProgress > 0 && (
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-200" aria-label={`Upload ${uploadProgress}%`}>
                      <div className="h-full bg-amber-600 transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void runUpload(pendingUpload)}
                    className="mt-4 flex min-h-11 items-center gap-2 rounded-xl bg-amber-900 px-4 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-50"
                  >
                    {saving ? <LoaderCircle className="animate-spin" size={14} /> : <RotateCcw size={14} />} Retry upload
                  </button>
                </div>
              </div>
            </section>
          )}

          {formOpen && (
            <div className="fixed inset-0 z-[75] flex items-end bg-ink/55 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}>
            <form onSubmit={saveMemory} className="max-h-[92dvh] w-full min-w-0 max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl border border-sepia bg-white p-4 shadow-2xl sm:space-y-6 sm:rounded-[2rem] sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-gold-ink">New memory</p>
                  <h3 className="mt-1 font-serif text-xl sm:mt-2 sm:text-2xl">What would you like to preserve?</h3>
                </div>
                <button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-sand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"><X size={20} /></button>
              </div>

              <div>
                <label htmlFor="memory-gathering" className="mb-1.5 block text-xs font-semibold text-ink/55 sm:mb-2">Gathering</label>
                <div className="relative">
                  <select
                    id="memory-gathering"
                    required
                    value={gatheringId}
                    onChange={event => setGatheringId(event.target.value)}
                    className="min-h-12 min-w-0 w-full max-w-full appearance-none rounded-xl border border-sepia bg-sand/40 px-4 py-2.5 pr-10 text-base outline-none focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
                  >
                    <option value="">Select a gathering</option>
                    {demoAlbums.map(album => (
                      <option key={album.id} value={album.id}>{album.title}</option>
                    ))}
                    {gatherings.map(gathering => (
                      <option key={gathering.id} value={gathering.id}>{gathering.title} — {readableDate(gathering.startAt)}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-ink/35" size={16} />
                </div>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-xs font-semibold text-ink/55 sm:mb-2">Memory type</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  {memoryTypeOptions.map(option => {
                    const Icon = option.icon;
                    return (
                      <button
                        type="button"
                        key={option.value}
                        aria-pressed={memoryType === option.value}
                        onClick={() => selectMemoryType(option.value)}
                        className={cn(
                          'min-h-24 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:rounded-2xl sm:p-4',
                          memoryType === option.value ? 'border-ink bg-ink text-white' : 'border-sepia bg-sand/30 text-ink hover:border-gold'
                        )}
                      >
                        <Icon size={19} className={memoryType === option.value ? 'text-gold' : 'text-ink/35'} />
                        <span className="mt-2 block text-xs font-semibold sm:mt-3">{option.label}</span>
                        <span className={cn('mt-1 block text-[11px] leading-relaxed', memoryType === option.value ? 'text-white/55' : 'text-ink/45')}>{option.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="memory-title" className="mb-1.5 block text-xs font-semibold text-ink/55 sm:mb-2">Title</label>
                  <input
                    id="memory-title"
                    required
                    minLength={2}
                    maxLength={150}
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    placeholder="Friday family story"
                    className="min-h-12 min-w-0 w-full max-w-full rounded-xl border border-sepia bg-sand/40 px-4 py-2.5 text-base outline-none focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="memory-date" className="mb-1.5 block text-xs font-semibold text-ink/55 sm:mb-2">Captured at</label>
                  <input
                    id="memory-date"
                    type="datetime-local"
                    required
                    value={capturedAt}
                    onChange={event => setCapturedAt(event.target.value)}
                    className="min-h-12 min-w-0 w-full max-w-full rounded-xl border border-sepia bg-sand/40 px-4 py-2.5 text-base outline-none focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="memory-note" className="mb-1.5 block text-xs font-semibold text-ink/55 sm:mb-2">
                  {memoryType === 'note' ? 'Written memory' : 'Caption (optional)'}
                </label>
                <textarea
                  id="memory-note"
                  required={memoryType === 'note'}
                  maxLength={10_000}
                  rows={4}
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder={memoryType === 'note' ? 'Write the story in your own words…' : 'Add context without identifying sensitive information…'}
                  className="min-w-0 w-full max-w-full resize-y rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-base leading-relaxed outline-none focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
                />
              </div>

              {memoryType !== 'note' && (
                <div>
                  <label htmlFor="memory-file" className="mb-1.5 block text-xs font-semibold text-ink/55 sm:mb-2">Private media file</label>
                  <input
                    ref={fileInputRef}
                    id="memory-file"
                    type="file"
                    required
                    accept={acceptedMimeTypes}
                    onChange={event => {
                      const nextFile = event.target.files?.[0] ?? null;
                      setFile(nextFile);
                      setFormError(nextFile ? validateMemoryFile(memoryType, nextFile) ?? '' : '');
                    }}
                    className="block min-h-12 min-w-0 w-full max-w-full rounded-xl border border-dashed border-sepia bg-sand/40 p-2.5 text-base file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:text-xs file:font-semibold file:text-white hover:border-gold sm:p-3 sm:text-xs sm:file:mr-4 sm:file:px-4"
                  />
                  <p className="mt-2 text-[11px] text-ink/45">Maximum {MAX_MEMORY_UPLOAD_BYTES / (1024 * 1024)} MB. Files remain behind authenticated family permissions.</p>
                </div>
              )}

              <div className="space-y-3 rounded-2xl border border-sepia bg-sand/30 p-4 sm:p-5">
                <label htmlFor="memory-visibility" className="flex items-center gap-2 text-xs font-semibold text-ink/55">
                  <LockKeyhole size={14} /> Who can view this?
                </label>
                <select
                  id="memory-visibility"
                  value={visibility}
                  onChange={event => {
                    setVisibility(event.target.value as MemoryVisibility);
                    if (event.target.value !== 'selected') setSelectedMemberIds([]);
                  }}
                  className="min-h-12 min-w-0 w-full max-w-full rounded-xl border border-sepia bg-white px-4 py-2.5 text-base outline-none focus:border-gold-ink focus:ring-2 focus:ring-gold-ink sm:text-sm"
                >
                  {Object.entries(visibilityCopy).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}
                </select>
                <p className="text-xs leading-relaxed text-ink/50">{visibilityCopy[visibility].detail}</p>

                {visibility === 'selected' && (
                  <fieldset className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-sepia bg-white p-3 sm:grid-cols-2">
                    <legend className="sr-only">Selected family viewers</legend>
                    {members.map(member => (
                      <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sand">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.id)}
                          onChange={() => toggleViewer(member.id)}
                          className="size-4 accent-gold"
                        />
                        <span>{personName(member)}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>

              {formError && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={15} /> {formError}</p>
              )}

              <div className="sticky bottom-0 z-10 -mx-4 grid grid-cols-2 gap-2 border-t border-sepia bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:flex sm:justify-end sm:gap-3 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-5 sm:backdrop-blur-none">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    resetForm();
                    setFormOpen(false);
                    setFormError('');
                  }}
                  className="min-h-11 rounded-xl border border-sepia px-4 text-xs font-semibold text-ink/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink sm:px-5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-xs font-semibold text-white hover:bg-gold-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 sm:px-6"
                >
                  {saving ? <LoaderCircle className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                  {saving ? (uploadProgress > 0 ? `Uploading ${uploadProgress}%` : 'Saving…') : 'Save memory'}
                </button>
              </div>
            </form>
            </div>
          )}

          {memories.length > 0 && <section className="space-y-3 sm:space-y-4">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <h3 className="font-serif text-xl sm:text-2xl">Saved family memories</h3>
              <span className="shrink-0 text-xs text-ink/65">{memories.length} saved</span>
            </div>
            <div className="grid gap-3 sm:gap-5">
              {memories.map(memory => (
                <div key={memory.id}>
                  <MemoryCard
                    memory={memory}
                    gatheringTitle={memory.gatheringId ? gatheringNames.get(memory.gatheringId) : undefined}
                    canDelete={memory.createdByUserId === currentUserId || familyRole === 'owner' || familyRole === 'admin'}
                    deleting={deletingMemoryId === memory.id}
                    onDelete={() => void deleteMemory(memory)}
                  />
                </div>
              ))}
            </div>
          </section>}
        </>
      ) : (
        <>
          <section className="rounded-2xl border border-sepia bg-ink p-4 text-white shadow-lg sm:rounded-[2rem] sm:p-7">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end sm:gap-6">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-gold"><Coins size={15} aria-hidden="true" /> Persisted points ledger</p>
                <p className="mt-2 font-serif text-3xl font-bold sm:mt-4 sm:text-5xl">{rewards.balance.toLocaleString()}</p>
                <p className="mt-1 text-[11px] text-white/50">Current family balance</p>
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-white/55">This balance is calculated from immutable reward entries created by completed server actions—not from browser state.</p>
            </div>
          </section>

          <section className="space-y-3 sm:space-y-4">
            <div className="flex min-h-11 items-center justify-between gap-3">
              <h3 className="font-serif text-xl sm:text-2xl">Points history</h3>
              <span className="text-[11px] text-ink/45">Latest {rewards.entries.length}</span>
            </div>
            {rewards.entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sepia bg-white p-5 text-center text-sm text-ink/50 sm:p-8">No points have been earned or spent yet.</div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm">
                {rewards.entries.map((entry, index) => (
                  <div key={entry.id} className={cn('flex items-center justify-between gap-3 px-4 py-3 sm:gap-5 sm:px-5 sm:py-4', index > 0 && 'border-t border-sepia')}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{entry.description}</p>
                      <p className="mt-1 text-[11px] text-ink/40">{entry.reasonCode.replaceAll('_', ' ')} • {readableDate(entry.createdAt)}</p>
                    </div>
                    <span className={cn('shrink-0 font-serif text-lg font-bold', entry.points > 0 ? 'text-emerald-700' : 'text-red-700')}>
                      {entry.points > 0 ? '+' : ''}{entry.points.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 sm:space-y-4">
            <div>
              <h3 className="font-serif text-xl sm:text-2xl">Reward offers</h3>
              <p className="mt-1 text-xs text-ink/45">Prototype examples are labelled and cannot be redeemed.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
              {rewards.offers.map(offer => (
                <div key={offer.id}>
                  <RewardOfferCard offer={offer} role={familyRole} redeeming={redeemingId === offer.id} onRedeem={redeem} />
                </div>
              ))}
            </div>
          </section>

          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
            <Sparkles className="mt-0.5 shrink-0" size={17} />
            Rewards shown as “prototype examples” are not vouchers, do not represent partner inventory, and never trigger a redemption request.
          </div>
        </>
      )}

      {selectedAlbum && (
        <div className="fixed inset-0 z-[80] flex items-end bg-ink/55 backdrop-blur-sm sm:items-center sm:justify-center sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedAlbum(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="memory-album-heading" className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-sepia bg-white shadow-2xl sm:rounded-[2rem]">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-sepia bg-sand px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <h3 id="memory-album-heading" className="truncate font-serif text-xl font-bold">{selectedAlbum.title}</h3>
                <p className="mt-1 truncate text-xs text-ink/65">{selectedAlbum.date} · {selectedAlbum.location}</p>
              </div>
              <button type="button" onClick={() => setSelectedAlbum(null)} aria-label="Close album" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-ink"><X size={20} /></button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {selectedAlbum.memories.map(memory => (
                <article key={memory.id} className="overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm">
                  {memory.image && memory.memoryType === 'photo' && <img src={memory.image} alt={memory.title} className="max-h-[28rem] w-full bg-sand object-cover" />}
                  {memory.image && memory.memoryType === 'video' && <video src={memory.image} controls className="max-h-[28rem] w-full bg-ink" />}
                  {memory.image && memory.memoryType === 'audio' && <div className="bg-sand p-5"><audio src={memory.image} controls className="w-full" /></div>}
                  {!memory.image && <div className="flex min-h-32 items-center justify-center bg-sand"><NotebookPen size={34} className="text-gold" /></div>}
                  <div className="p-4 sm:p-5">
                    <h4 className="font-serif text-lg font-bold">{memory.title}</h4>
                    <p className="mt-1 text-xs text-ink/60">{readableDate(memory.capturedAt)}</p>
                    {memory.note && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/75">{memory.note}</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
