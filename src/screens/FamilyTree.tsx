import React, { useState } from 'react';
import { FamilyMember, FamilyRole, LocationPrecision, LocationVisibility } from '../types';
import { Plus, Search, Heart, X, Calendar, Phone, Sparkles, UserPlus, Trash2, Share2, Camera, Upload, UserCircle, LoaderCircle, LocateFixed, MapPin, Save, ShieldCheck, Maximize2, Minimize2, ZoomIn, ZoomOut, Crosshair, RotateCcw, List, Network, Info } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { cn } from '../lib/utils';
import { calculateFitTransform, computeTreeLayout, generateConnections, getTreeBounds, groupMembersByFocus, relationshipLabelForFocus } from '../lib/treeLayout';
import { ApiError, familyApi } from '../api/client';
import { buildAddRelativeRequest, RelativeLinkType } from '../lib/familyRelationship';
import { useModalFocusTrap } from '../lib/modalFocus';

interface FamilyTreeProps {
  familyId: string;
  familyName: string;
  members: FamilyMember[];
  currentUserMemberId?: string;
  familyRole?: FamilyRole;
  onRefresh: () => Promise<void> | void;
  openLocationSettingsRequest?: boolean;
  onLocationSettingsRequestHandled?: () => void;
}

export const getGeneration = (member: FamilyMember): number => {
  if (member.generation !== undefined) return member.generation;
  if (member.relationship === 'Grandparent' || member.familyBranch === 'Elders') return 0;
  if (member.relationship === 'Parent') return 1;
  if (member.relationship === 'Me') return 2;
  return 3;
};

const addUniqueId = (ids: string[] | undefined, id: string) => (
  ids?.includes(id) ? ids : [...(ids || []), id]
);

const addUniqueIds = (ids: string[] | undefined, newIds: string[]) => (
  newIds.reduce((nextIds, id) => addUniqueId(nextIds, id), ids || [])
);

const getSpouseIds = (member: FamilyMember) => (
  addUniqueIds(member.spouseId ? [member.spouseId] : [], member.spouseIds || [])
);

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const createAnonymousAvatar = (seed: string) => {
  const hash = hashString(seed || 'family-member');
  const hue = hash % 360;
  const background = `hsl(${hue}, 38%, 22%)`;
  const border = `hsl(${hue}, 32%, 34%)`;
  const foreground = `hsl(${(hue + 42) % 360}, 82%, 74%)`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
      <rect width="128" height="128" fill="#101010"/>
      <circle cx="64" cy="64" r="54" fill="${background}" stroke="${border}" stroke-width="2"/>
      <circle cx="64" cy="48" r="15" fill="${foreground}"/>
      <path d="M36 92c2-19 17-31 28-31s26 12 28 31c.4 4-2.5 7-6.5 7h-43c-4 0-6.9-3-6.5-7z" fill="${foreground}"/>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

function CameraCaptureModal({ onCapture, onClose }: { onCapture: (photo: string) => void; onClose: () => void }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useModalFocusTrap<HTMLDivElement>({ active: true, onEscape: onClose });

  React.useEffect(() => {
    let mounted = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is blocked or unavailable.');
      return () => {
        mounted = false;
      };
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        setError('Camera access is blocked or unavailable.');
      });

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const size = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - size) / 2;
    const sourceY = (video.videoHeight - size) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, sourceX, sourceY, size, size, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.9));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-ink/50 backdrop-blur-sm md:items-center md:justify-center md:p-4">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="camera-heading" className="max-h-[100dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border border-sepia bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl md:rounded-[2rem]">
        <div className="bg-sand p-5 flex items-center justify-between border-b border-sepia">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-gold" />
            <h3 id="camera-heading" className="font-serif text-xl text-ink font-bold italic">Take profile photo</h3>
          </div>
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-full hover:bg-sepia/20 transition-colors" aria-label="Close camera">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="aspect-square bg-ink rounded-3xl overflow-hidden border border-sepia shadow-inner flex items-center justify-center">
            {error ? (
              <p className="text-white/70 text-sm text-center px-8">{error}</p>
            ) : (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCapture}
              disabled={Boolean(error)}
              className="min-h-11 flex-1 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-gold-ink disabled:pointer-events-none disabled:opacity-40"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-xl border border-sepia bg-white px-6 text-sm font-semibold text-ink/60 transition-all hover:border-gold hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhotoPicker({
  photo,
  fallbackSeed,
  onUpload: _onUpload,
  onCamera: _onCamera,
  onAnonymous: _onAnonymous
}: {
  photo?: string;
  fallbackSeed: string;
  onUpload: () => void;
  onCamera: () => void;
  onAnonymous: () => void;
}) {
  const preview = photo || createAnonymousAvatar(fallbackSeed);

  return (
    <div className="flex items-center gap-4 bg-sand/25 border border-sepia/50 rounded-2xl p-4">
      <img src={preview} alt="Profile preview" className="size-20 min-w-20 min-h-20 shrink-0 rounded-full object-cover overflow-hidden border border-sepia bg-white shadow-sm" />
      <div className="flex-1 min-w-0">
        <p className="mb-2 text-sm font-semibold text-ink/60">Profile photo</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled title="Private media storage is not connected yet" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-sepia bg-white px-3 text-xs font-semibold text-ink/30 cursor-not-allowed">
            <Upload size={13} /> Upload
          </button>
          <button type="button" disabled title="Private media storage is not connected yet" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-sepia bg-white px-3 text-xs font-semibold text-ink/30 cursor-not-allowed">
            <Camera size={13} /> Camera
          </button>
          <button type="button" disabled title="Private media storage is not connected yet" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-sepia bg-white px-3 text-xs font-semibold text-ink/30 cursor-not-allowed">
            <UserCircle size={13} /> Anonymous
          </button>
        </div>
        <p className="mt-2 text-xs text-ink/45">Private media storage is the next milestone; no photo is uploaded locally.</p>
      </div>
    </div>
  );
}

function FloralCorner({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 260 128"
      className={cn(
        "absolute top-4 hidden h-28 w-56 text-ink/70 pointer-events-none sm:block",
        side === 'left' ? "left-4" : "right-4 scale-x-[-1]"
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M78 32H246" />
      <path d="M54 32H66" />
      <path d="M14 92C31 76 44 56 53 31" />
      <path d="M16 86C8 71 7 58 14 48C25 56 28 68 21 82" />
      <path d="M31 65C25 49 27 36 39 27C48 39 45 53 34 64" />
      <path d="M49 43C45 29 48 17 59 10C67 22 63 34 53 43" />
      <path d="M11 96C24 94 36 98 45 107C32 113 20 110 11 96" />
      <path d="M26 78C38 76 49 81 55 91C42 96 32 91 26 78" />
      <path d="M44 56C55 55 64 60 69 70C57 74 49 69 44 56" />
      <path d="M33 35C27 27 23 18 22 8" />
      <path d="M24 21C17 18 12 13 9 6" />
      <path d="M26 22C32 17 37 11 40 4" />
      <path d="M28 31C21 32 14 30 7 26" />
      <path d="M31 36C38 35 45 37 52 41" />
      <path d="M70 61C78 52 92 54 96 66C107 68 111 82 101 90C101 102 87 108 78 99C68 105 55 98 57 86C48 77 57 62 70 61Z" />
      <path d="M77 73C84 68 93 74 91 82C89 91 76 91 74 82C73 78 74 75 77 73Z" />
      <path d="M71 62C71 55 76 50 83 49" />
      <path d="M96 67C102 63 109 64 114 69" />
      <path d="M101 90C107 94 109 101 106 108" />
      <path d="M78 99C76 106 70 110 63 109" />
      <path d="M57 86C50 87 44 83 41 77" />
    </svg>
  );
}

export function FamilyTree({
  familyId,
  familyName,
  members,
  currentUserMemberId,
  familyRole = 'member',
  onRefresh,
  openLocationSettingsRequest = false,
  onLocationSettingsRequestHandled,
}: FamilyTreeProps) {
  const prefersReducedMotion = useReducedMotion();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<FamilyMember | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [saving, setSaving] = useState(false);
  const canAdministerFamily = familyRole === 'owner' || familyRole === 'admin';

  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>('approximate');
  const [locationVisibility, setLocationVisibility] = useState<LocationVisibility>('family_admin');
  const [locationExpiryHours, setLocationExpiryHours] = useState('168');
  const [locationConsent, setLocationConsent] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);

  // Interactive mobile tree state. Relationship data remains read-only here;
  // focusing only recomputes presentation coordinates around another member.
  const [focusedMemberId, setFocusedMemberId] = useState(currentUserMemberId || members[0]?.id || '');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const locationDialogRef = useModalFocusTrap<HTMLElement>({
    active: locationSheetOpen,
    onEscape: () => setLocationSheetOpen(false),
    escapeDisabled: locating
  });
  const addDialogRef = useModalFocusTrap<HTMLDivElement>({
    active: addModalOpen,
    onEscape: () => setAddModalOpen(false),
    escapeDisabled: saving
  });
  const personDialogRef = useModalFocusTrap<HTMLDivElement>({
    active: Boolean(selectedPerson),
    onEscape: () => setSelectedPerson(null),
    escapeDisabled: saving
  });
  const treePanelRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const pointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = React.useRef<{
    midpoint?: { x: number; y: number };
    distance?: number;
    lastPoint?: { x: number; y: number };
  }>({});
  const scaleRef = React.useRef(1);
  const panRef = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    if (!openLocationSettingsRequest || !currentUserMemberId) return;
    setLocationSheetOpen(true);
    onLocationSettingsRequestHandled?.();
  }, [currentUserMemberId, onLocationSettingsRequestHandled, openLocationSettingsRequest]);

  // Form state for adding a relative
  const [formName, setFormName] = useState('');
  const [formRelatedToId, setFormRelatedToId] = useState(currentUserMemberId || members[0]?.id || '');
  const [formLinkType, setFormLinkType] = useState<RelativeLinkType>('Son');
  const [formBirthday, setFormBirthday] = useState('2000-01-01');
  const [formContact, setFormContact] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhoto, setFormPhoto] = useState('');
  const [formCoParentId, setFormCoParentId] = useState('');
  const [formEmirate, setFormEmirate] = useState('');
  const [cameraTarget, setCameraTarget] = useState<'add' | 'edit' | null>(null);
  const addPhotoInputRef = React.useRef<HTMLInputElement | null>(null);
  const editPhotoInputRef = React.useRef<HTMLInputElement | null>(null);

  const [editName, setEditName] = useState('');
  const [editBirthday, setEditBirthday] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');

  React.useEffect(() => {
    if (!members.some(member => member.id === formRelatedToId)) {
      setFormRelatedToId(currentUserMemberId || members[0]?.id || '');
    }
  }, [currentUserMemberId, formRelatedToId, members]);

  React.useEffect(() => {
    if (!members.some(member => member.id === focusedMemberId)) {
      setFocusedMemberId(currentUserMemberId || members[0]?.id || '');
    }
  }, [currentUserMemberId, focusedMemberId, members]);

  React.useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  React.useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement !== treePanelRef.current) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  React.useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  React.useEffect(() => {
    if (!selectedPerson) return;
    const latest = members.find(member => member.id === selectedPerson.id);
    if (!latest) {
      setSelectedPerson(null);
      return;
    }
    if (latest !== selectedPerson) setSelectedPerson(latest);
  }, [members, selectedPerson]);

  React.useEffect(() => {
    if (!selectedPerson) return;
    setEditName(selectedPerson.name);
    setEditBirthday(selectedPerson.birthday || '');
    setEditPhone(selectedPerson.phone || '');
    setEditEmail(selectedPerson.email || '');
    setEditNotes(selectedPerson.notes || '');
  }, [selectedPerson?.id]);

  const formRelatedPerson = React.useMemo(
    () => members.find(member => member.id === formRelatedToId),
    [members, formRelatedToId]
  );
  const formSpouseOptions = React.useMemo(
    () => formRelatedPerson
      ? getSpouseIds(formRelatedPerson)
        .map(spouseId => members.find(member => member.id === spouseId))
        .filter((member): member is FamilyMember => Boolean(member))
      : [],
    [members, formRelatedPerson]
  );

  React.useEffect(() => {
    if (formCoParentId && !formSpouseOptions.some(spouse => spouse.id === formCoParentId)) {
      setFormCoParentId('');
    }
  }, [formCoParentId, formSpouseOptions]);

  const readPhotoFile = (file: File, onPhotoReady: (photo: string) => void) => {
    if (!file.type.startsWith('image/')) {
      setMutationError('Please choose an image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMutationError('Profile photos must be smaller than 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onPhotoReady(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddPhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readPhotoFile(file, setFormPhoto);
    }
    e.target.value = '';
  };

  const updateSelectedPersonPhoto = async (photo: string) => {
    if (!selectedPerson) return;
    setSaving(true);
    setMutationError('');
    try {
      await familyApi.updateMember(selectedPerson.id, { photoUrl: photo });
      await onRefresh();
    } catch (caught) {
      setMutationError(caught instanceof ApiError ? caught.message : 'The profile photo could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditPhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readPhotoFile(file, updateSelectedPersonPhoto);
    }
    e.target.value = '';
  };

  const handleCameraCapture = (photo: string) => {
    if (cameraTarget === 'add') {
      setFormPhoto(photo);
      return;
    }

    if (cameraTarget === 'edit') {
      void updateSelectedPersonPhoto(photo);
    }
  };

  const resetAddForm = () => {
    setFormName('');
    setFormRelatedToId(currentUserMemberId || members[0]?.id || '');
    setFormLinkType('Son');
    setFormBirthday('2000-01-01');
    setFormContact('');
    setFormNotes('');
    setFormPhoto('');
    setFormCoParentId('');
    setFormEmirate('');
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formRelatedToId) return;
    setSaving(true);
    setMutationError('');
    try {
      await familyApi.createMember(familyId, buildAddRelativeRequest({
        displayName: formName,
        birthDate: formBirthday,
        phone: formContact,
        notes: formNotes,
        photoUrl: formPhoto,
        relatedMemberId: formRelatedToId,
        linkType: formLinkType,
        coParentId: formCoParentId,
        emirate: formEmirate
      }));

      await onRefresh();
      setAddModalOpen(false);
      resetAddForm();
    } catch (caught) {
      // The server transaction is authoritative; reload even after an error in
      // case the member was created before an optional co-parent link failed.
      await onRefresh();
      setMutationError(caught instanceof ApiError ? caught.message : 'The relative could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!canAdministerFamily) {
      setMutationError('Only a family owner or administrator can remove relatives.');
      return;
    }
    if (memberId === currentUserMemberId) {
      setMutationError('You cannot remove the family profile linked to your signed-in account.');
      return;
    }
    const target = members.find(m => m.id === memberId);
    if (!target) return;

    if (confirm(`Are you sure you want to remove ${target.name} from the family lineage and dashboard?`)) {
      setSaving(true);
      setMutationError('');
      try {
        await familyApi.deleteMember(memberId);
        setSelectedPerson(null);
        await onRefresh();
      } catch (caught) {
        setMutationError(caught instanceof ApiError ? caught.message : 'The relative could not be removed.');
      } finally {
        setSaving(false);
      }
    }
  };

  const handleSaveProfile = async () => {
    if (!selectedPerson || !editName.trim()) return;
    if (!canAdministerFamily && selectedPerson.id !== currentUserMemberId) {
      setMutationError('You can edit only the profile linked to your own account.');
      return;
    }
    setSaving(true);
    setMutationError('');
    try {
      await familyApi.updateMember(selectedPerson.id, {
        displayName: editName.trim(),
        birthDate: editBirthday || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        notes: editNotes.trim() || null
      });
      await onRefresh();
    } catch (caught) {
      setMutationError(caught instanceof ApiError ? caught.message : 'The profile changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleShareMyLocation = async () => {
    if (!currentUserMemberId) {
      setLocationError('Your account is not linked to a family member profile.');
      return;
    }
    if (!locationConsent) {
      setLocationError('Confirm consent before requesting your device location.');
      return;
    }
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location access.');
      return;
    }
    if (!window.isSecureContext) {
      setLocationError('Location access requires HTTPS or localhost.');
      return;
    }

    setLocating(true);
    setLocationError('');
    setLocationStatus('Waiting for your browser permission…');
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: locationPrecision === 'exact',
          maximumAge: 0,
          timeout: 15000
        });
      });
      await familyApi.updateLocation(currentUserMemberId, {
        consentGranted: true,
        source: 'browser',
        precision: locationPrecision,
        visibility: locationVisibility,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        expiresAt: locationExpiryHours
          ? new Date(Date.now() + Number(locationExpiryHours) * 60 * 60 * 1000).toISOString()
          : undefined
      });
      await onRefresh();
      setLocationStatus('Your one-time location update was saved with the selected privacy level.');
    } catch (caught) {
      if (caught && typeof caught === 'object' && 'code' in caught) {
        const geolocationError = caught as GeolocationPositionError;
        setLocationError(geolocationError.code === 1
          ? 'Location permission was denied. Nothing was shared.'
          : geolocationError.code === 3
            ? 'The location request timed out. Nothing was shared.'
            : 'Your location could not be determined. Nothing was shared.');
      } else {
        setLocationError(caught instanceof ApiError ? caught.message : 'Your location could not be saved.');
      }
      setLocationStatus('');
    } finally {
      setLocating(false);
    }
  };

  const handleRevokeMyLocation = async () => {
    if (!currentUserMemberId) return;
    if (!confirm('Stop sharing and delete your currently stored location?')) return;
    setLocating(true);
    setLocationError('');
    setLocationStatus('');
    try {
      await familyApi.revokeLocation(currentUserMemberId);
      setLocationConsent(false);
      setLocationStatus('Your location consent was revoked and the stored location was deleted.');
      await onRefresh();
    } catch (caught) {
      setLocationError(caught instanceof ApiError ? caught.message : 'Your location could not be removed.');
    } finally {
      setLocating(false);
    }
  };

  // Compact coordinates keep phone connectors short while the same graph
  // remains comfortably readable on tablet and desktop.
  const X_SPACING = 214;
  const Y_SPACING = 152;

  const layoutNodes = React.useMemo(
    () => computeTreeLayout(members, focusedMemberId || currentUserMemberId || members[0]?.id),
    [currentUserMemberId, focusedMemberId, members]
  );
  const connectionLines = React.useMemo(() => generateConnections(layoutNodes, X_SPACING, Y_SPACING), [layoutNodes]);
  const treeBounds = React.useMemo(
    // Extra vertical extent includes curved partner connectors above nodes.
    () => getTreeBounds(layoutNodes, X_SPACING, Y_SPACING, 116, 250),
    [layoutNodes]
  );
  const focusedMember = React.useMemo(
    () => members.find(member => member.id === focusedMemberId) || members[0],
    [focusedMemberId, members]
  );
  const relationshipGroups = React.useMemo(
    () => groupMembersByFocus(members, focusedMember?.id || ''),
    [focusedMember?.id, members]
  );
  const connectionHearts = React.useMemo(() => {
    const hearts = new Map<string, { id: string; x: number; y: number }>();

    connectionLines.forEach(line => {
      if (line.type !== 'spouse' && line.type !== 'sibling-hub') return;

      const x = line.heartX ?? (line.x1 + line.x2) / 2;
      const y = line.heartY ?? (line.y1 + line.y2) / 2;
      const id = line.type === 'sibling-hub' ? `sibling-heart-${x}-${y}` : `${line.id}-heart`;
      hearts.set(id, { id, x, y });
    });

    return Array.from(hearts.values());
  }, [connectionLines]);

  const applyTransform = React.useCallback((nextScale: number, nextPan: { x: number; y: number }) => {
    const boundedScale = Math.min(2.25, Math.max(0.02, nextScale));
    scaleRef.current = boundedScale;
    panRef.current = nextPan;
    setScale(boundedScale);
    setPan(nextPan);
  }, []);

  const fitTree = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layoutNodes.length) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const compactCanvas = rect.height < 240;
    const reservedFocusedCardHeight = compactCanvas ? 0 : 72;
    const fitPadding = compactCanvas ? 8 : 28;
    const next = calculateFitTransform(
      treeBounds,
      rect.width,
      Math.max(1, rect.height - reservedFocusedCardHeight),
      fitPadding,
      0.02,
      1.05
    );
    applyTransform(next.scale, { x: next.x, y: next.y - reservedFocusedCardHeight / 2 });
  }, [applyTransform, layoutNodes.length, treeBounds]);

  const centerOnMember = React.useCallback((memberId: string, preferredScale?: number) => {
    const node = layoutNodes.find(candidate => candidate.member.id === memberId);
    if (!node) return;
    const nextScale = preferredScale ?? Math.max(0.72, scaleRef.current);
    applyTransform(nextScale, {
      x: -(node.x * X_SPACING * nextScale),
      y: -(node.y * Y_SPACING * nextScale)
    });
  }, [applyTransform, layoutNodes]);

  const focusIntentRef = React.useRef(false);
  const handleFocusMember = React.useCallback((memberId: string) => {
    if (memberId === focusedMemberId) {
      setViewMode('tree');
      centerOnMember(memberId, Math.max(0.76, scaleRef.current));
      return;
    }
    focusIntentRef.current = true;
    setFocusedMemberId(memberId);
    setViewMode('tree');
  }, [centerOnMember, focusedMemberId]);

  React.useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (focusIntentRef.current) {
        focusIntentRef.current = false;
        centerOnMember(focusedMemberId, Math.max(0.76, scaleRef.current));
      } else {
        fitTree();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [centerOnMember, fitTree, focusedMemberId, members, viewMode]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleResize = () => fitTree();
    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', handleResize);
    }
    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [fitTree, viewMode]);

  const handleZoom = (factor: number) => {
    applyTransform(scaleRef.current * factor, panRef.current);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setIsDragging(true);
    const points = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;
    if (points.length === 1) {
      gestureRef.current = { lastPoint: points[0] };
    } else if (points.length === 2) {
      gestureRef.current = {
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;

    if (points.length === 1) {
      const previous = gestureRef.current.lastPoint || points[0];
      const nextPan = {
        x: panRef.current.x + points[0].x - previous.x,
        y: panRef.current.y + points[0].y - previous.y
      };
      gestureRef.current = { lastPoint: points[0] };
      applyTransform(scaleRef.current, nextPan);
      return;
    }

    const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
    const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const previousDistance = gestureRef.current.distance || distance;
    const previousMidpoint = gestureRef.current.midpoint || midpoint;
    const nextScale = Math.min(2.25, Math.max(0.02, scaleRef.current * (distance / Math.max(1, previousDistance))));
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const relativeMidpoint = canvasRect
      ? { x: midpoint.x - canvasRect.left - canvasRect.width / 2, y: midpoint.y - canvasRect.top - canvasRect.height / 2 }
      : midpoint;
    const worldPoint = {
      x: (relativeMidpoint.x - panRef.current.x) / scaleRef.current,
      y: (relativeMidpoint.y - panRef.current.y) / scaleRef.current
    };
    applyTransform(nextScale, {
      x: relativeMidpoint.x - worldPoint.x * nextScale + midpoint.x - previousMidpoint.x,
      y: relativeMidpoint.y - worldPoint.y * nextScale + midpoint.y - previousMidpoint.y
    });
    gestureRef.current = { midpoint, distance };
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = Array.from(pointersRef.current.values()) as Array<{ x: number; y: number }>;
    if (remaining.length === 1) gestureRef.current = { lastPoint: remaining[0] };
    else if (remaining.length === 0) {
      gestureRef.current = {};
      setIsDragging(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    handleZoom(event.deltaY < 0 ? 1.1 : 0.9);
  };

  const handleFullscreen = async () => {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (isFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      setIsFullscreen(false);
      return;
    }
    try {
      if (panel.requestFullscreen) await panel.requestFullscreen();
      setIsFullscreen(true);
    } catch {
      // iOS browsers without the Fullscreen API still get an in-app full-screen layer.
      setIsFullscreen(true);
    }
  };

  const resetTree = () => {
    setFocusedMemberId(currentUserMemberId || members[0]?.id || '');
    applyTransform(1, { x: 0, y: 0 });
  };

  const renderLocationControls = (idPrefix: string) => (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor={`${idPrefix}-precision`} className="text-xs font-semibold text-ink/70">
          Precision
          <select id={`${idPrefix}-precision`} value={locationPrecision} onChange={event => setLocationPrecision(event.target.value as LocationPrecision)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink sm:text-sm">
            <option value="approximate">Approximate area</option>
            <option value="city">City-level</option>
            <option value="exact">Exact (private storage)</option>
          </select>
        </label>
        <label htmlFor={`${idPrefix}-visibility`} className="text-xs font-semibold text-ink/70">
          Visible to
          <select id={`${idPrefix}-visibility`} value={locationVisibility} onChange={event => setLocationVisibility(event.target.value as LocationVisibility)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink sm:text-sm">
            <option value="private">Only me</option>
            <option value="family_admin">Family admins</option>
            <option value="family">Family</option>
          </select>
        </label>
        <label htmlFor={`${idPrefix}-expiry`} className="text-xs font-semibold text-ink/70">
          Expires
          <select id={`${idPrefix}-expiry`} value={locationExpiryHours} onChange={event => setLocationExpiryHours(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink sm:text-sm">
            <option value="24">24 hours</option>
            <option value="168">7 days</option>
            <option value="720">30 days</option>
            <option value="">Until replaced</option>
          </select>
        </label>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed text-ink/65">
        <input type="checkbox" checked={locationConsent} onChange={event => setLocationConsent(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[#C5A059]" />
        I consent to this one-time location request and the selected visibility.
      </label>
      <button type="button" onClick={handleShareMyLocation} disabled={!locationConsent || locating} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-gold-ink disabled:opacity-40">
        {locating ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <LocateFixed size={16} />}
        {locating ? 'Requesting permission' : 'Request and save location'}
      </button>
      {members.find(member => member.id === currentUserMemberId)?.safeLocation && (
        <button type="button" onClick={handleRevokeMyLocation} disabled={locating} className="min-h-11 w-full rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40">
          Revoke consent and delete location
        </button>
      )}
      {locationStatus && <p role="status" className="text-sm text-emerald-700">{locationStatus}</p>}
      {locationError && <p role="alert" className="text-sm text-red-600">{locationError}</p>}
    </div>
  );

  return (
    <div className="heritage-root flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-sand lg:h-auto lg:flex-none lg:gap-8 lg:overflow-visible">
      <section className="heritage-hero relative shrink-0 overflow-hidden rounded-2xl border border-sepia bg-white p-3 shadow-sm lg:rounded-[2rem] lg:p-8">
        <div className="pointer-events-none hidden lg:block"><FloralCorner side="left" /><FloralCorner side="right" /></div>
        <div className="heritage-hero-inner relative z-10 flex flex-col gap-3 lg:items-center lg:gap-6 lg:text-center">
          <div className="heritage-hero-family min-w-0 w-full lg:flex-none">
            <p className="hidden text-xs font-semibold text-ink/45 lg:block">Digital family tree of</p>
            <h3 className="truncate font-serif text-xl italic tracking-wide text-ink lg:text-4xl">{familyName}</h3>
            <p className="mt-0.5 text-xs text-ink/55 lg:hidden">{members.length} {members.length === 1 ? 'person' : 'people'} in your Heritage tree</p>
          </div>
          <div className="heritage-hero-actions grid w-full grid-cols-2 items-center gap-2 lg:flex lg:max-w-lg lg:justify-center">
            {currentUserMemberId && (
              <button type="button" onClick={() => setLocationSheetOpen(true)} className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-sepia bg-sand/40 px-3 text-sm font-semibold text-ink lg:hidden" aria-label="Location sharing settings">
                <LocateFixed size={18} /><span>Location</span>
              </button>
            )}
            {canAdministerFamily && (
              <button type="button" onClick={() => setAddModalOpen(true)} disabled={!members.length || saving} aria-label="Add relative" className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gold-ink disabled:opacity-40 lg:rounded-full lg:px-6">
                <Plus size={18} /><span>Add relative</span>
              </button>
            )}
            <div className="relative hidden flex-1 lg:block lg:max-w-xs">
              <label htmlFor="heritage-search" className="sr-only">Search family tree</label>
              <input id="heritage-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search family tree" className="min-h-11 w-full rounded-full border border-sepia bg-sand px-10 text-base focus:outline-none focus:ring-2 focus:ring-gold-ink" />
              <Search className="absolute left-3.5 top-3.5 text-ink/30" size={16} />
            </div>
          </div>
        </div>
      </section>

      {mutationError && (
        <div role="alert" className="flex shrink-0 items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{mutationError}</span>
          <button type="button" onClick={() => setMutationError('')} aria-label="Dismiss error" className="flex size-11 shrink-0 items-center justify-center rounded-full"><X size={18} /></button>
        </div>
      )}

      {currentUserMemberId && (
        <section className="hidden rounded-[2rem] border border-sepia bg-white p-6 shadow-sm lg:block" aria-labelledby="location-sharing-heading">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <LocateFixed size={18} className="text-gold" />
                <h4 id="location-sharing-heading" className="font-serif text-xl italic">Share my location once</h4>
              </div>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/55">
                This runs only when you press the button. It does not track you in the background. Non-exact coordinates are rounded before storage; the family map and AI receive only an authorized area or coarse distance summary.
              </p>
              {members.find(member => member.id === currentUserMemberId)?.safeLocation && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <MapPin size={14} />
                  {(() => {
                    const location = members.find(member => member.id === currentUserMemberId)?.safeLocation;
                    return location?.city || location?.emirate || location?.distanceBand || 'Location summary shared';
                  })()}
                </div>
              )}
            </div>
            <div className="w-full lg:w-[420px]">{renderLocationControls('desktop-location')}</div>
          </div>
        </section>
      )}

      {/* Interactive Tree Canvas */}
      <section
        ref={treePanelRef}
        aria-label="Interactive family tree"
        className={cn(
          'heritage-tree-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-sepia bg-[#FCFAF8] shadow-inner lg:h-[600px] lg:flex-none lg:rounded-[2.5rem]',
          isFullscreen && 'fixed inset-0 z-[70] h-[100dvh] rounded-none border-0 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]'
        )}
      >
        <div role="toolbar" className={cn('heritage-tree-toolbar sticky top-0 z-30 flex shrink-0 flex-col gap-1 border-b border-sepia bg-white/95 px-2 py-1 backdrop-blur-md lg:flex-row lg:items-center', isFullscreen && 'pt-[env(safe-area-inset-top)]')} aria-label="Tree controls">
          <div role="group" aria-label="Tree navigation and zoom" className="heritage-navigation-group flex w-full items-center justify-between gap-0.5 lg:w-auto lg:justify-start">
            <button type="button" onClick={fitTree} className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label="Fit entire tree"><Crosshair size={17} /> Fit</button>
            <button type="button" onClick={() => currentUserMemberId && handleFocusMember(currentUserMemberId)} disabled={!currentUserMemberId} className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-ink hover:bg-sand disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label="Focus on me"><UserCircle size={17} /> Me</button>
            <button type="button" onClick={() => handleZoom(1.18)} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label="Zoom in"><ZoomIn size={19} /></button>
            <button type="button" onClick={() => handleZoom(0.84)} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label="Zoom out"><ZoomOut size={19} /></button>
            <button type="button" onClick={resetTree} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label="Reset tree view"><RotateCcw size={18} /></button>
            <button type="button" onClick={handleFullscreen} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-ink hover:bg-sand focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label={isFullscreen ? 'Exit full screen' : 'Open full screen'} aria-pressed={isFullscreen}>
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
          <div className="heritage-toolbar-secondary flex w-full min-w-0 items-center gap-1 lg:ml-auto lg:w-auto">
            <div role="group" className="flex shrink-0 rounded-xl border border-sepia bg-sand/50 p-0.5" aria-label="Heritage view">
              <button type="button" onClick={() => setViewMode('tree')} aria-pressed={viewMode === 'tree'} className={cn('flex min-h-11 items-center gap-1 rounded-[0.6rem] px-2.5 text-xs font-semibold', viewMode === 'tree' ? 'bg-white text-ink shadow-sm' : 'text-ink/55')}><Network size={16} /> Tree</button>
              <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} className={cn('flex min-h-11 items-center gap-1 rounded-[0.6rem] px-2.5 text-xs font-semibold', viewMode === 'list' ? 'bg-white text-ink shadow-sm' : 'text-ink/55')}><List size={16} /> List</button>
            </div>
            <div className="heritage-landscape-actions hidden shrink-0 items-center gap-0.5" aria-label="Heritage actions">
              {currentUserMemberId && (
                <button type="button" onClick={() => setLocationSheetOpen(true)} className="flex size-11 items-center justify-center rounded-xl text-ink hover:bg-sand" aria-label="Location sharing settings"><LocateFixed size={18} /></button>
              )}
              {canAdministerFamily && (
                <button type="button" onClick={() => setAddModalOpen(true)} disabled={!members.length || saving} className="flex size-11 items-center justify-center rounded-xl text-ink hover:bg-sand disabled:opacity-40" aria-label="Add relative"><Plus size={18} /></button>
              )}
              {focusedMember && (
                <button type="button" onClick={() => setSelectedPerson(focusedMember)} className="flex size-11 items-center justify-center rounded-xl text-ink hover:bg-sand" aria-label={`View ${focusedMember.name} profile`}><Info size={18} /></button>
              )}
            </div>
            <div className="heritage-mobile-search relative min-w-0 flex-1 lg:hidden">
              <label htmlFor="mobile-heritage-search" className="sr-only">Search family tree</label>
              <Search className="pointer-events-none absolute left-3 top-3.5 text-ink/35" size={16} />
              <input id="mobile-heritage-search" type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search family" className="min-h-11 w-full rounded-xl border border-sepia bg-sand/40 pl-9 pr-2 text-base text-ink outline-none focus:ring-2 focus:ring-gold-ink" />
            </div>
          </div>
        </div>

        {viewMode === 'tree' ? (
        <div
          ref={canvasRef}
          data-testid="heritage-tree-canvas"
          data-tree-scale={scale.toFixed(3)}
          className={cn('relative min-h-0 flex-1 touch-none select-none overflow-hidden overscroll-none bg-[radial-gradient(circle_at_center,rgba(197,160,89,0.08),transparent_62%)]', isDragging ? 'cursor-grabbing' : 'cursor-grab')}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onWheel={handleWheel}
          onDoubleClick={() => focusedMember && centerOnMember(focusedMember.id, Math.max(0.9, scaleRef.current))}
          aria-label="Family tree canvas. Drag to pan, pinch or use controls to zoom, and tap a person to focus."
        >
          {layoutNodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink/55">Add a relative to begin your family tree.</div>
          ) : (
          <div className={cn('absolute left-1/2 top-1/2 size-0 origin-center motion-reduce:transition-none', isDragging ? '' : 'transition-transform duration-300 ease-out')} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
            {/* SVG Lines */}
            <svg aria-hidden="true" className="absolute overflow-visible pointer-events-none" style={{ top: 0, left: 0 }}>
              {connectionLines.map(line => (
                <path 
                  key={line.id}
                  data-tree-connector="true"
                  d={
                    line.type === 'parent-child' 
                      ? `M ${line.x1} ${line.y1 + (line.fromHeart ? 12 : 38)} L ${line.x1} ${(line.y1 + line.y2) / 2 + (line.routeOffset || 0)} L ${line.x2} ${(line.y1 + line.y2) / 2 + (line.routeOffset || 0)} L ${line.x2} ${line.y2 - 38}`
                      : line.type === 'sibling-hub'
                        ? `M ${line.x1} ${line.y1 + 10} L ${line.x1} ${(line.y1 + line.y2) / 2} L ${line.x2} ${(line.y1 + line.y2) / 2} L ${line.x2} ${line.y2 - 38}`
                        : line.curve
                          ? `M ${line.x1 + 38} ${line.y1} C ${line.x1 + 140} ${line.y1 + line.curve} ${(line.heartX || line.x2) - 140} ${line.y1 + line.curve} ${line.heartX || line.x2} ${line.heartY || line.y2} L ${line.x2 - 38} ${line.y2}`
                          : `M ${line.x1 + 38} ${line.y1} L ${line.x2 - 38} ${line.y2}`
                  }
                  fill="none"
                  stroke={line.type === 'spouse' ? '#C5A059' : '#a8a29e'}
                  strokeWidth={line.type === 'spouse' ? 2 : 1.5}
                  strokeDasharray={line.type === 'relative' ? '6 5' : undefined}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="opacity-70"
                />
              ))}
            </svg>

            {/* Couple and Sibling Hearts */}
            {connectionHearts.map(heart => (
              <div 
                key={heart.id}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 bg-[#FCFAF8] px-1.5 text-gold"
                style={{ left: heart.x, top: heart.y }}
              >
                <Heart size={11} fill="currentColor" stroke="none" />
              </div>
            ))}

            {/* Nodes */}
            {layoutNodes.map(node => {
              const member = node.member;
              const isFocused = member.id === focusedMember?.id;
              const isMatch = Boolean(searchQuery) && (member.name.toLowerCase().includes(searchQuery.toLowerCase()) || member.relationship.toLowerCase().includes(searchQuery.toLowerCase()) || Boolean(member.familyBranch?.toLowerCase().includes(searchQuery.toLowerCase())));
              const relationshipLabel = relationshipLabelForFocus(
                member.id,
                focusedMember?.id || '',
                relationshipGroups,
                focusedMember?.id === currentUserMemberId ? member.relationship : 'Relative'
              );
              return (
                <div
                  aria-hidden="true"
                  key={member.id}
                  className={cn(
                    'pointer-events-none absolute flex w-[116px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl border bg-white/95 px-2 py-2 text-center shadow-md backdrop-blur-sm',
                    isFocused ? 'z-10 border-gold ring-4 ring-gold/15' : 'z-0 border-sepia',
                    isMatch && 'z-20 ring-4 ring-gold/30'
                  )}
                  style={{ left: node.x * X_SPACING, top: node.y * Y_SPACING }}
                >
                  <img src={member.photo || createAnonymousAvatar(member.id)} alt="" className="pointer-events-none size-12 shrink-0 rounded-full border border-sepia/30 bg-white object-cover shadow-sm" />
                  <span className={cn('mt-1.5 block w-full truncate font-serif text-base font-semibold italic leading-tight text-ink', scale < 0.78 && 'invisible')} title={member.name}>{member.name}</span>
                  <span className={cn('mt-0.5 block w-full truncate text-xs font-semibold text-ink/55', scale < 0.78 && 'invisible')}>{relationshipLabel}</span>
                </div>
              );
            })}
          </div>
          )}

          {layoutNodes.length > 0 && layoutNodes.map(node => {
            const member = node.member;
            const isFocused = member.id === focusedMember?.id;
            const relationshipLabel = relationshipLabelForFocus(
              member.id,
              focusedMember?.id || '',
              relationshipGroups,
              focusedMember?.id === currentUserMemberId ? member.relationship : 'Relative'
            );
            const screenX = pan.x + node.x * X_SPACING * scale;
            const screenY = pan.y + node.y * Y_SPACING * scale;
            const screenLabelWidth = Math.max(52, Math.min(88, X_SPACING * scale - 8));

            return (
              <button
                type="button"
                key={`hit-${member.id}`}
                data-testid="heritage-node-hit-target"
                data-member-id={member.id}
                onPointerDown={event => event.stopPropagation()}
                onClick={() => handleFocusMember(member.id)}
                onDoubleClick={(event) => { event.stopPropagation(); setSelectedPerson(member); }}
                className={cn(
                  'pointer-events-auto absolute left-1/2 top-1/2 z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl bg-transparent transition-[left,top] duration-300 ease-out motion-reduce:transition-none focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-ink',
                  isDragging && 'transition-none',
                  isFocused && 'z-20'
                )}
                style={{
                  left: `calc(50% + ${screenX}px)`,
                  top: `calc(50% + ${screenY}px)`,
                  minWidth: 44,
                  minHeight: 44
                }}
                aria-label={`${member.name}, ${relationshipLabel}. Tap to focus; double tap for profile.`}
                aria-pressed={isFocused}
              >
                {scale < 0.78 && (
                  <span
                    data-testid="heritage-node-screen-label"
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white/90 px-1 py-0.5 text-center shadow-sm backdrop-blur-sm"
                    style={{ width: screenLabelWidth }}
                  >
                    <span className="block truncate text-[11px] font-semibold leading-tight text-ink">{member.name}</span>
                    <span className="block truncate text-[10px] font-semibold leading-tight text-ink/60">{relationshipLabel}</span>
                  </span>
                )}
              </button>
            );
          })}

          {focusedMember && (
            <div className="heritage-focus-card absolute bottom-3 left-3 right-3 z-30 flex items-center gap-2 rounded-2xl border border-sepia bg-white/95 p-2 shadow-lg backdrop-blur lg:left-auto lg:w-[300px]">
              <img src={focusedMember.photo || createAnonymousAvatar(focusedMember.id)} alt="" className="size-10 rounded-full object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{focusedMember.name}</p>
                <p className="text-xs text-ink/50">Focused person</p>
              </div>
              <button type="button" onClick={() => setSelectedPerson(focusedMember)} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-sepia px-3 text-xs font-semibold text-ink" aria-label={`View ${focusedMember.name} profile`}><Info size={16} /> Details</button>
            </div>
          )}
        </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:p-6" data-testid="heritage-list-view">
            {focusedMember && (
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold/10 p-3">
                <img src={focusedMember.photo || createAnonymousAvatar(focusedMember.id)} alt="" className="size-12 rounded-full object-cover" />
                <div className="min-w-0"><p className="truncate font-serif text-lg font-semibold italic">{focusedMember.name}</p><p className="text-xs text-ink/55">Focused person</p></div>
              </div>
            )}
            <div className="space-y-5">
              {([
                ['Parents', relationshipGroups.parents],
                ['Partner / spouse', relationshipGroups.partners],
                ['Siblings', relationshipGroups.siblings],
                ['Children', relationshipGroups.children],
                ['Other relatives', relationshipGroups.others]
              ] as const).map(([heading, group]) => (
                <section key={heading} aria-labelledby={`heritage-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                  <h4 id={`heritage-${heading.toLowerCase().replace(/[^a-z]+/g, '-')}`} className="mb-2 text-sm font-semibold text-ink/55">{heading} <span className="font-normal">({group.length})</span></h4>
                  {group.length ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {group.map(member => (
                        <button type="button" key={member.id} onClick={() => handleFocusMember(member.id)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-sepia bg-white p-2.5 text-left transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-gold-ink" aria-label={`Focus on ${member.name} in tree`}>
                          <img src={member.photo || createAnonymousAvatar(member.id)} alt="" className="size-11 shrink-0 rounded-full object-cover" />
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink" title={member.name}>{member.name}</span><span className="block text-xs text-ink/50">Tap to focus in Tree view</span></span>
                        </button>
                      ))}
                    </div>
                  ) : <p className="rounded-xl border border-dashed border-sepia px-3 py-2 text-xs text-ink/45">No {heading.toLowerCase()} linked.</p>}
                </section>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Heritage Tip — outside tree area */}
      <div className="hidden rounded-3xl border border-gold/15 bg-white/95 p-5 shadow-lg backdrop-blur-md lg:block">
        <div className="mb-2 flex items-center gap-2"><Heart size={12} className="text-gold" /><span className="text-xs font-bold text-ink">Heritage tip</span></div>
        <p className="text-sm font-serif italic leading-relaxed text-ink/60">Preserve traditions by letting younger family members register local stories inside the family tree memories list.</p>
      </div>

      <p className="hidden items-center justify-center gap-3 py-6 text-xs font-semibold text-ink/45 lg:flex"><Share2 size={16} /> Select relatives for private invitations in Gatherings</p>

      <AnimatePresence>
        {locationSheetOpen && currentUserMemberId && (
          <div className="fixed inset-0 z-[80] flex items-end bg-ink/45 backdrop-blur-sm lg:hidden" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocationSheetOpen(false); }}>
            <motion.section
              ref={locationDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-location-heading"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[2rem] bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl motion-reduce:transition-none"
            >
              <div className="sticky top-0 z-10 -mx-4 mb-4 flex min-h-14 items-center justify-between border-b border-sepia bg-white px-4">
                <div><h4 id="mobile-location-heading" className="font-serif text-xl font-semibold italic">Location sharing</h4><p className="text-xs text-ink/50">One-time and privacy controlled</p></div>
                <button type="button" onClick={() => setLocationSheetOpen(false)} className="flex size-11 items-center justify-center rounded-full" aria-label="Close location sharing"><X size={20} /></button>
              </div>
              <p className="mb-4 text-sm leading-relaxed text-ink/60">Your device location is requested only when you confirm below. It is never background tracking.</p>
              {renderLocationControls('mobile-location')}
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      {/* Add Relative Modal */}
      <AnimatePresence>
        {addModalOpen && canAdministerFamily && (
          <div className="fixed inset-0 z-[80] flex items-end bg-ink/40 backdrop-blur-sm md:items-center md:justify-center md:p-4">
            <motion.div 
              ref={addDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-relative-heading"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] border border-sepia bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl md:max-h-[85dvh] md:rounded-[2.5rem]"
            >
              <form onSubmit={handleAddMemberSubmit} className="flex min-h-0 flex-1 flex-col">
                <input
                  ref={addPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAddPhotoFile}
                  hidden
                  className="hidden"
                />
                {/* Header */}
                <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-sepia bg-sand px-4 py-3 md:p-6">
                  <div className="flex items-center gap-2">
                    <UserPlus size={18} className="text-gold" />
                    <h3 id="add-relative-heading" className="font-serif text-xl text-ink font-bold italic">Add relative to tree</h3>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAddModalOpen(false)}
                    className="flex size-11 items-center justify-center rounded-full hover:bg-sepia/20 transition-colors"
                    aria-label="Close add relative"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form Fields */}
                <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm text-ink md:p-6">
                  <PhotoPicker
                    photo={formPhoto}
                    fallbackSeed={formName || 'new-relative'}
                    onUpload={() => addPhotoInputRef.current?.click()}
                    onCamera={() => setCameraTarget('add')}
                    onAnonymous={() => setFormPhoto('')}
                  />

                  {/* Name */}
                  <div className="space-y-1">
                    <label htmlFor="add-relative-name" className="block text-sm font-semibold">Full name</label>
                    <input 
                      id="add-relative-name"
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Zayed Al Mansouri"
                      className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-4 text-base focus:outline-none focus:ring-2 focus:ring-gold-ink"
                    />
                  </div>

                  {/* Relationship To */}
                  <div className="space-y-1">
                    <label htmlFor="add-relative-related-to" className="block text-sm font-semibold">Relationship to</label>
                    <select
                      id="add-relative-related-to"
                      value={formRelatedToId}
                      onChange={(e) => setFormRelatedToId(e.target.value)}
                      className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-gold-ink md:text-sm"
                    >
                      {members.map(person => (
                        <option key={person.id} value={person.id}>{person.name} ({person.id === currentUserMemberId ? 'Me' : person.relationship})</option>
                      ))}
                    </select>
                  </div>

                  {/* Type of Link */}
                  <div className="space-y-1">
                    <label htmlFor="add-relative-link-type" className="block text-sm font-semibold">Type of link (lineage connection)</label>
                    <select
                      id="add-relative-link-type"
                      value={formLinkType}
                      onChange={(e) => setFormLinkType(e.target.value as RelativeLinkType)}
                      className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-gold-ink md:text-sm"
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Son">Son</option>
                      <option value="Daughter">Daughter</option>
                      <option value="Brother">Brother</option>
                      <option value="Sister">Sister</option>
                      <option value="Spouse">Spouse</option>
                    </select>
                  </div>

                  {(formLinkType === 'Son' || formLinkType === 'Daughter') && formSpouseOptions.length > 0 && (
                    <div className="space-y-1">
                      <label htmlFor="add-relative-co-parent" className="block text-sm font-semibold">Other parent</label>
                      <select
                        id="add-relative-co-parent"
                        value={formCoParentId}
                        onChange={(e) => setFormCoParentId(e.target.value)}
                        className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-4 text-base text-ink focus:outline-none focus:ring-2 focus:ring-gold-ink md:text-sm"
                      >
                        <option value="">No second parent selected</option>
                        {formSpouseOptions.map(spouse => (
                          <option key={spouse.id} value={spouse.id}>{spouse.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Birthday & Contact */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label htmlFor="add-relative-birthday" className="block text-sm font-semibold">Birthday date</label>
                      <input 
                        id="add-relative-birthday"
                        type="date"
                        value={formBirthday}
                        onChange={(e) => setFormBirthday(e.target.value)}
                        className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-gold-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="add-relative-contact" className="block text-sm font-semibold">Contact information</label>
                      <input 
                        id="add-relative-contact"
                        type="text"
                        value={formContact}
                        onChange={(e) => setFormContact(e.target.value)}
                        placeholder="+971 50..."
                        className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-gold-ink"
                      />
                    </div>
                  </div>

                  {/* Approximate location & notes */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label htmlFor="add-relative-emirate" className="block text-sm font-semibold">Approximate emirate</label>
                      <select
                        id="add-relative-emirate"
                        value={formEmirate}
                        onChange={(e) => setFormEmirate(e.target.value)}
                        className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base focus:outline-none focus:ring-2 focus:ring-gold-ink"
                      >
                        <option value="">Not provided</option>
                        {['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'].map(emirate => <option key={emirate}>{emirate}</option>)}
                      </select>
                      <p className="text-xs leading-snug text-ink/45">Admin-reported area; not device tracking.</p>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="add-relative-note" className="block text-sm font-semibold">Primary note</label>
                      <input 
                        id="add-relative-note"
                        type="text"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="e.g. Traditional poetry reader"
                        className="min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base focus:outline-none focus:ring-2 focus:ring-gold-ink"
                      />
                    </div>
                  </div>

                  {mutationError && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{mutationError}</p>}
                </div>

                {/* Footer */}
                <div className="flex shrink-0 gap-3 border-t border-sepia bg-sand p-4 md:p-6">
                  <button 
                    type="submit"
                    disabled={saving}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-center text-sm font-semibold text-white shadow transition-colors hover:bg-gold-ink disabled:opacity-50"
                  >
                    {saving && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />} Add to lineage
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setAddModalOpen(false)}
                    className="min-h-11 rounded-xl border border-sepia bg-white px-5 text-sm font-semibold text-ink/60 transition-all hover:border-gold hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Person Detail Drawer/Modal */}
      <AnimatePresence>
        {selectedPerson && (
          <div className="fixed inset-0 z-[80] flex items-end bg-ink/40 backdrop-blur-sm md:items-center md:justify-center md:p-4">
            <motion.div 
              ref={personDialogRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby="person-profile-heading"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] border border-sepia bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl md:max-h-[88dvh] md:rounded-[2.5rem]"
            >
              <input
                ref={editPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={handleEditPhotoFile}
                hidden
                className="hidden"
              />
              {/* Header */}
              <div className="flex shrink-0 items-start justify-between border-b border-sepia bg-sand p-4 md:p-6">
                <div className="flex items-center gap-4">
                  <img src={selectedPerson.photo || createAnonymousAvatar(selectedPerson.id)} alt={selectedPerson.name} className="size-14 min-w-14 min-h-14 shrink-0 rounded-full object-cover overflow-hidden border border-sepia p-0.5 bg-white shadow-sm" />
                  <div>
                    <span className="text-xs font-semibold text-gold-ink">
                      {selectedPerson.id === currentUserMemberId ? `Me (${familyRole})` : selectedPerson.relationship}
                    </span>
                    <h3 id="person-profile-heading" className="font-serif text-xl text-ink font-bold italic leading-tight">{selectedPerson.name}</h3>
                    <p className="text-xs font-semibold text-ink/45">Branch: {selectedPerson.familyBranch || 'Main'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedPerson(null)}
                  type="button"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-sepia/20 transition-colors"
                  aria-label="Close profile"
                >
                  <X size={20} className="text-ink/60" />
                </button>
              </div>

              {/* Body */}
              <div className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4 text-sm text-ink md:p-6">
                <PhotoPicker
                  photo={selectedPerson.photo}
                  fallbackSeed={selectedPerson.id}
                  onUpload={() => editPhotoInputRef.current?.click()}
                  onCamera={() => setCameraTarget('edit')}
                  onAnonymous={() => updateSelectedPersonPhoto(createAnonymousAvatar(selectedPerson.id))}
                />

                {/* Persistent profile fields */}
                {(canAdministerFamily || selectedPerson.id === currentUserMemberId) ? (
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-ink/60">
                    Full name
                    <input required value={editName} onChange={event => setEditName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink" />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-semibold text-ink/60">
                      <span className="flex items-center gap-1"><Calendar size={12} className="text-gold" /> Birthday</span>
                      <input type="date" value={editBirthday} onChange={event => setEditBirthday(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink" />
                    </label>
                    <label className="block text-sm font-semibold text-ink/60">
                      <span className="flex items-center gap-1"><Phone size={12} className="text-gold" /> Phone</span>
                      <input value={editPhone} onChange={event => setEditPhone(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink" placeholder="+971 50…" />
                    </label>
                  </div>
                  <label className="block text-sm font-semibold text-ink/60">
                    Email
                    <input type="email" value={editEmail} onChange={event => setEditEmail(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-sepia bg-sand/30 px-3 text-base text-ink" placeholder="Optional" />
                  </label>
                  <label className="block text-sm font-semibold text-ink/60">
                    Notes
                    <textarea rows={3} value={editNotes} onChange={event => setEditNotes(event.target.value)} className="mt-1 w-full resize-none rounded-xl border border-sepia bg-sand/30 px-3 py-2.5 text-base text-ink" placeholder="Family context or accessibility needs" />
                  </label>
                </div>
                ) : (
                  <p className="rounded-xl border border-sepia/50 bg-sand/30 p-4 text-sm text-ink/55">
                    Private contact, birthday, and notes fields are visible only to that person and family administrators.
                  </p>
                )}

                {/* Lineage Info */}
                <div className="bg-sand/30 border border-sepia/50 p-4 rounded-xl space-y-2">
                  <h4 className="text-sm font-semibold text-ink/50">Heritage lineage</h4>
                  <p className="text-sm">
                    <strong>Parents: </strong> 
                    {selectedPerson.parentIds && selectedPerson.parentIds.length > 0 
                      ? members.filter(p => selectedPerson.parentIds?.includes(p.id)).map(p => p.name).join(', ') 
                      : 'Eldest Ancestor (No registered parents)'}
                  </p>
                  {getSpouseIds(selectedPerson).length > 0 && (
                    <p className="text-sm">
                      <strong>Spouse: </strong> 
                      {members.filter(p => getSpouseIds(selectedPerson).includes(p.id)).map(p => p.name).join(', ') || 'Linked Spouse'}
                    </p>
                  )}
                  {selectedPerson.childrenIds && selectedPerson.childrenIds.length > 0 && (
                    <p className="text-sm">
                      <strong>Children: </strong> 
                      {members.filter(p => selectedPerson.childrenIds?.includes(p.id)).map(p => p.name).join(', ')}
                    </p>
                  )}
                  {selectedPerson.siblingIds && selectedPerson.siblingIds.length > 0 && (
                    <p className="text-sm">
                      <strong>Siblings: </strong>
                      {members.filter(p => selectedPerson.siblingIds?.includes(p.id)).map(p => p.name).join(', ')}
                    </p>
                  )}
                </div>

                {selectedPerson.safeLocation && (
                  <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start gap-3">
                    <ShieldCheck size={16} className="text-emerald-700 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-800">Privacy-filtered location</h4>
                      <p className="mt-1 text-sm text-emerald-800/75">
                        {selectedPerson.safeLocation.city || selectedPerson.safeLocation.emirate || selectedPerson.safeLocation.distanceBand || 'A location summary is available to authorized viewers.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-sand/20 border border-sepia/50 p-4 rounded-xl">
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink/50"><Sparkles size={14} className="text-gold" /> Memories</h4>
                  <p className="mt-2 text-sm text-ink/50">Family memories are saved with explicit privacy controls in the Archive and attached to persisted gatherings.</p>
                </div>

                {mutationError && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{mutationError}</p>}
              </div>

              {/* Footer */}
              <div className="flex shrink-0 gap-2 border-t border-sepia bg-sand p-4 md:gap-3 md:p-6">
                {(canAdministerFamily || selectedPerson.id === currentUserMemberId) && (
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={saving || !editName.trim()}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-center text-sm font-semibold text-white shadow transition-colors hover:bg-gold-ink disabled:opacity-50"
                  >
                    {saving ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Save size={14} />} Save
                  </button>
                )}
                {canAdministerFamily && selectedPerson.id !== currentUserMemberId && (
                  <button 
                    type="button"
                    onClick={() => handleRemoveMember(selectedPerson.id)}
                    disabled={saving}
                    className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-600 transition-all hover:bg-red-100"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => setSelectedPerson(null)}
                  className="min-h-11 rounded-xl border border-sepia bg-white px-4 text-sm font-semibold text-ink/60 transition-all hover:border-gold hover:text-ink"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cameraTarget && (
          <CameraCaptureModal
            onCapture={handleCameraCapture}
            onClose={() => setCameraTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
