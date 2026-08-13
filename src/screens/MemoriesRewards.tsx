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
  NotebookPen,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
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
}

interface PendingUpload {
  memoryId: string;
  uploadPath: string;
  file: File;
  memoryType: Exclude<MemoryType, 'note'>;
}

const blankRewards: RewardSummary = { balance: 0, entries: [], offers: [] };

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
  return new Intl.DateTimeFormat(undefined, {
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
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-sepia bg-sand/60 px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-ink/60 hover:border-gold disabled:cursor-wait"
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
    <article className="space-y-5 rounded-[2rem] border border-sepia bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-2xl bg-gold/10 p-3 text-gold"><TypeIcon size={20} /></div>
          <div className="min-w-0">
            <h4 className="font-serif text-xl font-bold text-ink break-words">{memory.title}</h4>
            <p className="mt-1 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-ink/40">
              <Clock3 size={11} /> {readableDate(memory.capturedAt)}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-sepia px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-ink/50">
          {visibilityCopy[memory.visibility].label}
        </span>
      </div>

      {gatheringTitle && (
        <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gold">
          <CalendarDays size={13} /> {gatheringTitle}
        </p>
      )}
      {memory.note && <p className="whitespace-pre-wrap font-serif text-sm italic leading-relaxed text-ink/70">{memory.note}</p>}
      {memory.memoryType !== 'note' && <MemoryMedia memory={memory} />}

      <div className="flex flex-wrap items-center gap-3 border-t border-sepia/60 pt-4 text-[9px] font-bold uppercase tracking-wider text-ink/40">
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
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
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
      'rounded-2xl border p-5',
      offer.isDemo ? 'border-dashed border-sepia bg-sand/50' : 'border-sepia bg-white'
    )}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-serif font-bold text-ink">{offer.title}</h4>
            {offer.isDemo && (
              <span className="rounded-full bg-ink/5 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-ink/50">Prototype example</span>
            )}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink/60">{offer.description}</p>
          {offer.partnerName && <p className="mt-2 text-[9px] font-bold uppercase tracking-wider text-ink/40">Partner: {offer.partnerName}</p>}
        </div>
        <Gift className="shrink-0 text-gold" size={22} />
      </div>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => onRedeem(offer)}
        className="mt-5 w-full rounded-xl bg-ink px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-ink/35"
      >
        {buttonText}
      </button>
      {offer.isDemo && <p className="mt-2 text-center text-[9px] text-ink/40">No voucher or partner connection exists for this example.</p>}
    </article>
  );
}

export function MemoriesRewards({ familyId, familyRole, currentUserId, members, refreshVersion = 0 }: MemoriesRewardsProps) {
  const [view, setView] = useState<'memories' | 'rewards'>('memories');
  const [gatherings, setGatherings] = useState<PersistentGathering[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
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
      setGatheringId(previous => previous || completedGatherings[0]?.id || '');
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
    setGatheringId('');
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

  if (loading) {
    return (
      <div className="flex min-h-72 items-center justify-center rounded-[2rem] border border-sepia bg-white">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-gold" size={28} />
          <p className="mt-3 font-serif italic text-ink/60">Opening the private family archive…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-2xl border border-sepia bg-white p-1 shadow-sm" role="tablist" aria-label="Family archive sections">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'memories'}
            onClick={() => setView('memories')}
            className={cn('rounded-xl px-5 py-3 text-[10px] font-bold uppercase tracking-widest', view === 'memories' ? 'bg-ink text-white' : 'text-ink/45')}
          >
            Memories
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'rewards'}
            onClick={() => setView('rewards')}
            className={cn('rounded-xl px-5 py-3 text-[10px] font-bold uppercase tracking-widest', view === 'rewards' ? 'bg-ink text-white' : 'text-ink/45')}
          >
            Rewards
          </button>
        </div>
        <button
          type="button"
          onClick={() => void loadData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink/45 hover:text-gold disabled:cursor-wait"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
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
          <section className="overflow-hidden rounded-[2rem] border border-sepia bg-ink text-white shadow-lg">
            <div className="flex flex-col justify-between gap-6 p-7 sm:flex-row sm:items-center">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-gold">Private family archive</p>
                <h3 className="mt-2 font-serif text-2xl italic">Preserve what happened after a gathering</h3>
                <p className="mt-2 max-w-lg text-xs leading-relaxed text-white/60">
                  Every memory is stored against a real gathering and follows the visibility you choose. Media is fetched through your signed-in session.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFormOpen(open => !open)}
                disabled={gatherings.length === 0 || Boolean(pendingUpload)}
                className="shrink-0 rounded-2xl bg-gold px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white hover:text-ink disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
              >
                {formOpen ? 'Close form' : 'Add memory'}
              </button>
            </div>
          </section>

          {gatherings.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Create a persisted gathering first. Memories cannot be attached to local or sample calendar entries.
            </div>
          )}

          {pendingUpload && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
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
                    className="mt-4 flex items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-[9px] font-bold uppercase tracking-widest text-white disabled:cursor-wait disabled:opacity-50"
                  >
                    {saving ? <LoaderCircle className="animate-spin" size={14} /> : <RotateCcw size={14} />} Retry upload
                  </button>
                </div>
              </div>
            </section>
          )}

          {formOpen && (
            <form onSubmit={saveMemory} className="space-y-6 rounded-[2rem] border border-sepia bg-white p-7 shadow-sm">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-gold">New memory</p>
                <h3 className="mt-2 font-serif text-2xl italic">What would you like to preserve?</h3>
              </div>

              <div>
                <label htmlFor="memory-gathering" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-ink/50">Gathering</label>
                <div className="relative">
                  <select
                    id="memory-gathering"
                    required
                    value={gatheringId}
                    onChange={event => setGatheringId(event.target.value)}
                    className="w-full appearance-none rounded-xl border border-sepia bg-sand/40 px-4 py-3 pr-10 text-sm outline-none focus:border-gold"
                  >
                    <option value="">Select a persisted gathering</option>
                    {gatherings.map(gathering => (
                      <option key={gathering.id} value={gathering.id}>{gathering.title} — {readableDate(gathering.startAt)}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-ink/35" size={16} />
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-[9px] font-bold uppercase tracking-widest text-ink/50">Memory type</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {memoryTypeOptions.map(option => {
                    const Icon = option.icon;
                    return (
                      <button
                        type="button"
                        key={option.value}
                        aria-pressed={memoryType === option.value}
                        onClick={() => selectMemoryType(option.value)}
                        className={cn(
                          'rounded-2xl border p-4 text-left transition-colors',
                          memoryType === option.value ? 'border-ink bg-ink text-white' : 'border-sepia bg-sand/30 text-ink hover:border-gold'
                        )}
                      >
                        <Icon size={19} className={memoryType === option.value ? 'text-gold' : 'text-ink/35'} />
                        <span className="mt-3 block text-[10px] font-bold uppercase tracking-wider">{option.label}</span>
                        <span className={cn('mt-1 block text-[9px] leading-relaxed', memoryType === option.value ? 'text-white/50' : 'text-ink/40')}>{option.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="memory-title" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-ink/50">Title</label>
                  <input
                    id="memory-title"
                    required
                    minLength={2}
                    maxLength={150}
                    value={title}
                    onChange={event => setTitle(event.target.value)}
                    placeholder="Friday family story"
                    className="w-full rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-sm outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <label htmlFor="memory-date" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-ink/50">Captured at</label>
                  <input
                    id="memory-date"
                    type="datetime-local"
                    required
                    value={capturedAt}
                    onChange={event => setCapturedAt(event.target.value)}
                    className="w-full rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-sm outline-none focus:border-gold"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="memory-note" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-ink/50">
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
                  className="w-full resize-y rounded-xl border border-sepia bg-sand/40 px-4 py-3 text-sm leading-relaxed outline-none focus:border-gold"
                />
              </div>

              {memoryType !== 'note' && (
                <div>
                  <label htmlFor="memory-file" className="mb-2 block text-[9px] font-bold uppercase tracking-widest text-ink/50">Private media file</label>
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
                    className="block w-full rounded-xl border border-dashed border-sepia bg-sand/40 p-3 text-xs file:mr-4 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:py-2 file:text-[9px] file:font-bold file:uppercase file:tracking-widest file:text-white hover:border-gold"
                  />
                  <p className="mt-2 text-[9px] text-ink/40">Maximum {MAX_MEMORY_UPLOAD_BYTES / (1024 * 1024)} MB. Files remain behind authenticated family permissions.</p>
                </div>
              )}

              <div className="space-y-3 rounded-2xl border border-sepia bg-sand/30 p-5">
                <label htmlFor="memory-visibility" className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink/50">
                  <LockKeyhole size={14} /> Who can view this?
                </label>
                <select
                  id="memory-visibility"
                  value={visibility}
                  onChange={event => {
                    setVisibility(event.target.value as MemoryVisibility);
                    if (event.target.value !== 'selected') setSelectedMemberIds([]);
                  }}
                  className="w-full rounded-xl border border-sepia bg-white px-4 py-3 text-sm outline-none focus:border-gold"
                >
                  {Object.entries(visibilityCopy).map(([value, copy]) => <option key={value} value={value}>{copy.label}</option>)}
                </select>
                <p className="text-xs leading-relaxed text-ink/50">{visibilityCopy[visibility].detail}</p>

                {visibility === 'selected' && (
                  <fieldset className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-sepia bg-white p-3 sm:grid-cols-2">
                    <legend className="sr-only">Selected family viewers</legend>
                    {members.map(member => (
                      <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-xs hover:bg-sand">
                        <input
                          type="checkbox"
                          checked={selectedMemberIds.includes(member.id)}
                          onChange={() => toggleViewer(member.id)}
                          className="accent-gold"
                        />
                        <span>{personName(member)}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-sepia p-5">
                <input
                  type="checkbox"
                  checked={aiProcessingAllowed}
                  onChange={event => setAiProcessingAllowed(event.target.checked)}
                  className="mt-1 accent-gold"
                />
                <span>
                  <span className="flex items-center gap-2 text-xs font-bold text-ink"><Bot size={15} /> Allow AI processing for this memory</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-ink/45">
                    Off by default. This stores your consent choice; no face recognition is used and this version does not run memory analysis.
                  </span>
                </span>
              </label>

              {formError && (
                <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"><AlertCircle className="mt-0.5 shrink-0" size={15} /> {formError}</p>
              )}

              <div className="flex flex-wrap justify-end gap-3 border-t border-sepia pt-5">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    resetForm();
                    setFormOpen(false);
                    setFormError('');
                  }}
                  className="rounded-xl border border-sepia px-5 py-3 text-[9px] font-bold uppercase tracking-widest text-ink/50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || gatherings.length === 0}
                  className="flex items-center gap-2 rounded-xl bg-ink px-6 py-3 text-[9px] font-bold uppercase tracking-widest text-white hover:bg-gold disabled:cursor-wait disabled:opacity-50"
                >
                  {saving ? <LoaderCircle className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                  {saving ? (uploadProgress > 0 ? `Uploading ${uploadProgress}%` : 'Saving…') : 'Save privately'}
                </button>
              </div>
            </form>
          )}

          <section className="space-y-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-serif text-2xl italic">Family memories</h3>
              <span className="text-[9px] font-bold uppercase tracking-wider text-ink/35">{memories.length} visible to you</span>
            </div>
            {memories.length === 0 ? (
              <div className="rounded-[2rem] border border-dashed border-sepia bg-white p-10 text-center">
                <NotebookPen className="mx-auto text-gold" size={28} />
                <h4 className="mt-4 font-serif text-xl italic">No permitted memories yet</h4>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink/50">Add the first memory after a real gathering. Private memories belonging to other people do not appear here.</p>
              </div>
            ) : (
              <div className="grid gap-5">
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
            )}
          </section>

          <p className="flex items-center justify-center gap-2 text-center text-[9px] leading-relaxed text-ink/35">
            <ShieldCheck size={13} /> Media access is authorized on every request. No face recognition or public gallery is enabled.
          </p>
        </>
      ) : (
        <>
          <section className="rounded-[2rem] border border-sepia bg-ink p-7 text-white shadow-lg">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <p className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em] text-gold"><Coins size={14} /> Persisted points ledger</p>
                <p className="mt-4 font-serif text-5xl font-bold">{rewards.balance.toLocaleString()}</p>
                <p className="mt-1 text-[10px] uppercase tracking-widest text-white/45">Current family balance</p>
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-white/55">This balance is calculated from immutable reward entries created by completed server actions—not from browser state.</p>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-serif text-2xl italic">Points history</h3>
              <span className="text-[9px] font-bold uppercase tracking-wider text-ink/35">Latest {rewards.entries.length}</span>
            </div>
            {rewards.entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sepia bg-white p-8 text-center text-sm text-ink/50">No points have been earned or spent yet.</div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-sepia bg-white shadow-sm">
                {rewards.entries.map((entry, index) => (
                  <div key={entry.id} className={cn('flex items-center justify-between gap-5 px-5 py-4', index > 0 && 'border-t border-sepia')}>
                    <div>
                      <p className="text-sm font-semibold text-ink">{entry.description}</p>
                      <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-ink/35">{entry.reasonCode.replaceAll('_', ' ')} • {readableDate(entry.createdAt)}</p>
                    </div>
                    <span className={cn('shrink-0 font-serif text-lg font-bold', entry.points > 0 ? 'text-emerald-700' : 'text-red-700')}>
                      {entry.points > 0 ? '+' : ''}{entry.points.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="font-serif text-2xl italic">Reward offers</h3>
              <p className="mt-1 text-xs text-ink/45">Prototype examples are labelled and cannot be redeemed.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  );
}
