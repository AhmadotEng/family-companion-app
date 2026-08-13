import React, { useState } from 'react';
import { FamilyMember, FamilyRole, LocationPrecision, LocationVisibility } from '../types';
import { Plus, Search, Heart, X, Calendar, Phone, Sparkles, UserPlus, Trash2, Users, Share2, Camera, Upload, UserCircle, LoaderCircle, LocateFixed, MapPin, Save, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { computeTreeLayout, generateConnections } from '../lib/treeLayout';
import { ApiError, familyApi } from '../api/client';
import { buildAddRelativeRequest, RelativeLinkType } from '../lib/familyRelationship';

interface FamilyTreeProps {
  familyId: string;
  familyName: string;
  members: FamilyMember[];
  currentUserMemberId?: string;
  familyRole?: FamilyRole;
  onRefresh: () => Promise<void> | void;
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
    <div className="fixed inset-0 bg-ink/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-[2rem] border border-sepia shadow-2xl overflow-hidden">
        <div className="bg-sand p-5 flex items-center justify-between border-b border-sepia">
          <div className="flex items-center gap-2">
            <Camera size={18} className="text-gold" />
            <h3 className="font-serif text-xl text-ink font-bold italic">Take Profile Photo</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-sepia/20 transition-colors">
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
              className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              Capture
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 bg-white border border-sepia text-ink/60 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
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
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink/50 mb-2">Profile Photo</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled title="Private media storage is not connected yet" className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/30 cursor-not-allowed flex items-center gap-1.5">
            <Upload size={13} /> Upload
          </button>
          <button type="button" disabled title="Private media storage is not connected yet" className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/30 cursor-not-allowed flex items-center gap-1.5">
            <Camera size={13} /> Camera
          </button>
          <button type="button" disabled title="Private media storage is not connected yet" className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/30 cursor-not-allowed flex items-center gap-1.5">
            <UserCircle size={13} /> Anonymous
          </button>
        </div>
        <p className="text-[9px] text-ink/40 mt-2">Private media storage is the next milestone; no photo is uploaded locally.</p>
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

export function FamilyTree({ familyId, familyName, members, currentUserMemberId, familyRole = 'member', onRefresh }: FamilyTreeProps) {
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

  // Panning State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

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

  // Tree Layout Computation
  const X_SPACING = 280;
  const Y_SPACING = 180;
  
  const layoutNodes = React.useMemo(
    () => computeTreeLayout(members, currentUserMemberId || members[0]?.id),
    [currentUserMemberId, members]
  );
  const connectionLines = React.useMemo(() => generateConnections(layoutNodes, X_SPACING, Y_SPACING), [layoutNodes]);
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

  return (
    <div className="space-y-8 flex flex-col h-full bg-sand">
      {/* Header Info */}
      <section className="bg-white p-8 rounded-[2rem] border border-sepia shadow-sm relative overflow-hidden flex flex-col items-center text-center">
        <FloralCorner side="left" />
        <FloralCorner side="right" />
        <div className="relative z-10 flex flex-col gap-6 items-center w-full">
          <div className="space-y-1">
            <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-ink/40">Digital Family Tree of</p>
            <h3 className="text-4xl font-serif italic text-ink tracking-wide">{familyName}</h3>
            <div className="w-16 h-px bg-sepia mx-auto mt-4 opacity-50 border-t border-dashed"></div>
          </div>
          <div className="flex gap-3 w-full max-w-lg justify-center">
            {canAdministerFamily && (
              <button
                onClick={() => setAddModalOpen(true)}
                disabled={!members.length || saving}
                className="bg-ink text-white px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg hover:bg-gold transition-colors"
              >
                <Plus size={16} /> Add relative
              </button>
            )}
            <div className="relative flex-1 max-w-xs">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ancestors..."
                className="bg-sand border border-sepia rounded-full px-10 py-2.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-gold"
              />
              <Search className="absolute left-3.5 top-3 text-ink/30" size={14} />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3.5 top-3 text-ink/40">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="absolute -bottom-10 -right-10 text-gold opacity-5 rotate-12 -z-0 pointer-events-none">
          <Users size={220} />
        </div>
      </section>

      {mutationError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 flex items-start justify-between gap-4">
          <span>{mutationError}</span>
          <button type="button" onClick={() => setMutationError('')} aria-label="Dismiss error"><X size={16} /></button>
        </div>
      )}

      {currentUserMemberId && (
        <section className="bg-white border border-sepia rounded-[2rem] p-6 shadow-sm" aria-labelledby="location-sharing-heading">
          <div className="flex flex-col lg:flex-row lg:items-start gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <LocateFixed size={18} className="text-gold" />
                <h4 id="location-sharing-heading" className="font-serif italic text-xl">Share my location once</h4>
              </div>
              <p className="text-xs text-ink/55 mt-2 leading-relaxed max-w-xl">
                This runs only when you press the button. It does not track you in the background. Non-exact coordinates are rounded before storage; the family map and AI receive only an authorized area or coarse distance summary.
              </p>
              {members.find(member => member.id === currentUserMemberId)?.safeLocation && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  <MapPin size={12} />
                  {(() => {
                    const location = members.find(member => member.id === currentUserMemberId)?.safeLocation;
                    return location?.city || location?.emirate || location?.distanceBand || 'Location summary shared';
                  })()}
                </div>
              )}
            </div>
            <div className="w-full lg:w-[360px] space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="text-[9px] uppercase tracking-wider font-bold text-ink/60">
                  Precision
                  <select value={locationPrecision} onChange={event => setLocationPrecision(event.target.value as LocationPrecision)} className="mt-1 w-full rounded-xl border border-sepia bg-sand/30 px-3 py-2 text-xs normal-case tracking-normal text-ink">
                    <option value="approximate">Approximate area</option>
                    <option value="city">City-level</option>
                    <option value="exact">Exact (private storage)</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-wider font-bold text-ink/60">
                  Visible to
                  <select value={locationVisibility} onChange={event => setLocationVisibility(event.target.value as LocationVisibility)} className="mt-1 w-full rounded-xl border border-sepia bg-sand/30 px-3 py-2 text-xs normal-case tracking-normal text-ink">
                    <option value="private">Only me</option>
                    <option value="family_admin">Family admins</option>
                    <option value="family">Family</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-wider font-bold text-ink/60">
                  Expires
                  <select value={locationExpiryHours} onChange={event => setLocationExpiryHours(event.target.value)} className="mt-1 w-full rounded-xl border border-sepia bg-sand/30 px-3 py-2 text-xs normal-case tracking-normal text-ink">
                    <option value="24">24 hours</option>
                    <option value="168">7 days</option>
                    <option value="720">30 days</option>
                    <option value="">Until replaced</option>
                  </select>
                </label>
              </div>
              <label className="flex items-start gap-2 text-[11px] text-ink/65 leading-relaxed">
                <input type="checkbox" checked={locationConsent} onChange={event => setLocationConsent(event.target.checked)} className="mt-0.5 accent-[#C5A059]" />
                I consent to this one-time location request and the selected visibility.
              </label>
              <button type="button" onClick={handleShareMyLocation} disabled={!locationConsent || locating} className="w-full bg-ink text-white rounded-xl py-2.5 text-[9px] uppercase tracking-widest font-bold flex items-center justify-center gap-2 hover:bg-gold disabled:opacity-40">
                {locating ? <LoaderCircle size={14} className="animate-spin" /> : <LocateFixed size={14} />}
                {locating ? 'Requesting permission' : 'Request and save location'}
              </button>
              {members.find(member => member.id === currentUserMemberId)?.safeLocation && (
                <button type="button" onClick={handleRevokeMyLocation} disabled={locating} className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-[9px] font-bold uppercase tracking-widest text-red-700 hover:bg-red-100 disabled:opacity-40">
                  Revoke consent & delete location
                </button>
              )}
              {locationStatus && <p role="status" className="text-[11px] text-emerald-700">{locationStatus}</p>}
              {locationError && <p role="alert" className="text-[11px] text-red-600">{locationError}</p>}
            </div>
          </div>
        </section>
      )}

      {/* Interactive Tree Canvas */}
      <div 
        className="relative min-h-[500px] h-[600px] bg-[#FCFAF8] rounded-[2.5rem] border border-sepia overflow-hidden shadow-inner cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          className="absolute inset-0 transition-transform duration-75 ease-out origin-center"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          {/* Centering wrapper: puts (0,0) of the tree at the visual center of the canvas initially */}
          <div className="absolute top-1/2 left-1/2 w-0 h-0">
            {/* SVG Lines */}
            <svg className="absolute overflow-visible pointer-events-none" style={{ top: 0, left: 0 }}>
              {connectionLines.map(line => (
                <path 
                  key={line.id}
                  d={
                    line.type === 'parent-child' 
                      ? `M ${line.x1} ${line.y1 + (line.fromHeart ? 12 : 45)} L ${line.x1} ${(line.y1 + line.y2) / 2 + (line.routeOffset || 0)} L ${line.x2} ${(line.y1 + line.y2) / 2 + (line.routeOffset || 0)} L ${line.x2} ${line.y2 - 45}`
                      : line.type === 'sibling-hub'
                        ? `M ${line.x1} ${line.y1 + 12} L ${line.x1} ${(line.y1 + line.y2) / 2} L ${line.x2} ${(line.y1 + line.y2) / 2} L ${line.x2} ${line.y2 - 45}`
                        : line.curve
                          ? `M ${line.x1 + 45} ${line.y1} C ${line.x1 + 170} ${line.y1 + line.curve} ${(line.heartX || line.x2) - 170} ${line.y1 + line.curve} ${line.heartX || line.x2} ${line.heartY || line.y2} L ${line.x2 - 45} ${line.y2}`
                          : `M ${line.x1 + 45} ${line.y1} L ${line.x2 - 45} ${line.y2}`
                  }
                  fill="none"
                  stroke="#a8a29e"
                  strokeWidth="1.5"
                  className="opacity-70"
                />
              ))}
            </svg>

            {/* Couple and Sibling Hearts */}
            {connectionHearts.map(heart => (
              <div 
                key={heart.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 bg-[#FCFAF8] px-2 text-ink/70"
                style={{ left: heart.x, top: heart.y }}
              >
                <Heart size={12} fill="currentColor" stroke="none" />
              </div>
            ))}

            {/* Nodes */}
            {layoutNodes.map(node => {
              const m = node.member;
              const isMatch = searchQuery && (m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.relationship.toLowerCase().includes(searchQuery.toLowerCase()) || (m.familyBranch && m.familyBranch.toLowerCase().includes(searchQuery.toLowerCase())));
              return (
                <div 
                  key={m.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedPerson(m); }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all flex flex-col items-center gap-2",
                    isMatch ? "scale-110 z-10 drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]" : "z-0 hover:scale-105"
                  )}
                  style={{ left: node.x * X_SPACING, top: node.y * Y_SPACING }}
                >
                  <img src={m.photo || createAnonymousAvatar(m.id)} alt={m.name} className="size-20 min-w-20 min-h-20 shrink-0 rounded-full object-cover overflow-hidden shadow-lg pointer-events-none border border-sepia/20" />
                  <div className="text-center pointer-events-none pt-1 bg-[#FCFAF8]/80 backdrop-blur-sm rounded-xl px-2">
                    <h5 className="text-[22px] font-serif italic text-ink leading-tight tracking-wide whitespace-nowrap">{m.name}</h5>
                    <span className="text-[8px] uppercase tracking-[0.2em] text-ink/60 mt-0.5 block">{m.relationship === 'Me' ? 'Main' : m.relationship}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Heritage Tip — outside tree area */}
      <div className="bg-white/95 backdrop-blur-md p-5 rounded-3xl border border-gold/15 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <Heart size={12} className="text-gold" />
          <span className="text-[10px] font-bold text-ink uppercase tracking-widest">Heritage Tip</span>
        </div>
        <p className="text-[11px] text-ink/60 leading-relaxed italic font-serif">
          "Preserve traditions by letting younger family members register local stories inside the family tree memories list."
        </p>
      </div>

      <p className="flex items-center justify-center gap-3 py-6 text-[10px] font-bold uppercase tracking-[0.2em] text-ink/45">
        <Share2 size={16} /> Select relatives for private invitations in Gatherings
      </p>

      {/* Add Relative Modal */}
      <AnimatePresence>
        {addModalOpen && canAdministerFamily && (
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] border border-sepia overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
            >
              <form onSubmit={handleAddMemberSubmit}>
                <input
                  ref={addPhotoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAddPhotoFile}
                  className="hidden"
                />
                {/* Header */}
                <div className="bg-sand p-6 flex justify-between items-center border-b border-sepia">
                  <div className="flex items-center gap-2">
                    <UserPlus size={18} className="text-gold" />
                    <h3 className="font-serif text-xl text-ink font-bold italic">Add Relative to Tree</h3>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setAddModalOpen(false)}
                    className="p-1 rounded-full hover:bg-sepia/20 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Form Fields */}
                <div className="p-6 space-y-4 overflow-y-auto max-h-[55vh] custom-scrollbar text-sm text-ink">
                  <PhotoPicker
                    photo={formPhoto}
                    fallbackSeed={formName || 'new-relative'}
                    onUpload={() => addPhotoInputRef.current?.click()}
                    onCamera={() => setCameraTarget('add')}
                    onAnonymous={() => setFormPhoto('')}
                  />

                  {/* Name */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Full Name</label>
                    <input 
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Zayed Al Mansouri"
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold"
                    />
                  </div>

                  {/* Relationship To */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Relationship To</label>
                    <select
                      value={formRelatedToId}
                      onChange={(e) => setFormRelatedToId(e.target.value)}
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold text-sm text-ink"
                    >
                      {members.map(person => (
                        <option key={person.id} value={person.id}>{person.name} ({person.id === currentUserMemberId ? 'Me' : person.relationship})</option>
                      ))}
                    </select>
                  </div>

                  {/* Type of Link */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Type of Link (Lineage Connection)</label>
                    <select
                      value={formLinkType}
                      onChange={(e) => setFormLinkType(e.target.value as RelativeLinkType)}
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold text-sm text-ink"
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
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Other Parent</label>
                      <select
                        value={formCoParentId}
                        onChange={(e) => setFormCoParentId(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold text-sm text-ink"
                      >
                        <option value="">No second parent selected</option>
                        {formSpouseOptions.map(spouse => (
                          <option key={spouse.id} value={spouse.id}>{spouse.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Birthday & Contact */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Birthday Date</label>
                      <input 
                        type="date"
                        value={formBirthday}
                        onChange={(e) => setFormBirthday(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs text-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Contact Information</label>
                      <input 
                        type="text"
                        value={formContact}
                        onChange={(e) => setFormContact(e.target.value)}
                        placeholder="+971 50..."
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs text-ink"
                      />
                    </div>
                  </div>

                  {/* Approximate location & notes */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Approximate Emirate</label>
                      <select
                        value={formEmirate}
                        onChange={(e) => setFormEmirate(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs"
                      >
                        <option value="">Not provided</option>
                        {['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'].map(emirate => <option key={emirate}>{emirate}</option>)}
                      </select>
                      <p className="text-[9px] text-ink/40 leading-snug">Admin-reported area; not device tracking.</p>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Primary Note</label>
                      <input 
                        type="text"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="e.g. Traditional poetry reader"
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs"
                      />
                    </div>
                  </div>

                  {mutationError && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{mutationError}</p>}
                </div>

                {/* Footer */}
                <div className="p-6 bg-sand border-t border-sepia flex gap-4">
                  <button 
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving && <LoaderCircle size={14} className="animate-spin" />} Add to Lineage
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setAddModalOpen(false)}
                    className="px-6 bg-white border border-sepia text-ink/60 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
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
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] border border-sepia overflow-hidden shadow-2xl flex flex-col"
            >
              <input
                ref={editPhotoInputRef}
                type="file"
                accept="image/*"
                onChange={handleEditPhotoFile}
                className="hidden"
              />
              {/* Header */}
              <div className="bg-sand p-6 flex justify-between items-start border-b border-sepia">
                <div className="flex items-center gap-4">
                  <img src={selectedPerson.photo || createAnonymousAvatar(selectedPerson.id)} alt={selectedPerson.name} className="size-14 min-w-14 min-h-14 shrink-0 rounded-full object-cover overflow-hidden border border-sepia p-0.5 bg-white shadow-sm" />
                  <div>
                    <span className="text-[8px] uppercase tracking-widest text-gold font-bold">
                      {selectedPerson.id === currentUserMemberId ? `Me (${familyRole})` : selectedPerson.relationship}
                    </span>
                    <h3 className="font-serif text-xl text-ink font-bold italic leading-tight">{selectedPerson.name}</h3>
                    <p className="text-[9px] text-ink/40 font-bold uppercase tracking-wider">Branch: {selectedPerson.familyBranch || 'Main'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedPerson(null)}
                  className="p-1 rounded-full hover:bg-sepia/20 transition-colors"
                >
                  <X size={20} className="text-ink/60" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6 text-sm text-ink max-h-[50vh] overflow-y-auto custom-scrollbar">
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
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-ink/50">
                    Full name
                    <input required value={editName} onChange={event => setEditName(event.target.value)} className="mt-1 w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 text-xs normal-case tracking-normal text-ink" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-ink/50">
                      <span className="flex items-center gap-1"><Calendar size={12} className="text-gold" /> Birthday</span>
                      <input type="date" value={editBirthday} onChange={event => setEditBirthday(event.target.value)} className="mt-1 w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 text-xs normal-case tracking-normal text-ink" />
                    </label>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-ink/50">
                      <span className="flex items-center gap-1"><Phone size={12} className="text-gold" /> Phone</span>
                      <input value={editPhone} onChange={event => setEditPhone(event.target.value)} className="mt-1 w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 text-xs normal-case tracking-normal text-ink" placeholder="+971 50…" />
                    </label>
                  </div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-ink/50">
                    Email
                    <input type="email" value={editEmail} onChange={event => setEditEmail(event.target.value)} className="mt-1 w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 text-xs normal-case tracking-normal text-ink" placeholder="Optional" />
                  </label>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-ink/50">
                    Notes
                    <textarea rows={3} value={editNotes} onChange={event => setEditNotes(event.target.value)} className="mt-1 w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2.5 text-xs normal-case tracking-normal text-ink resize-none" placeholder="Family context or accessibility needs" />
                  </label>
                </div>
                ) : (
                  <p className="rounded-xl border border-sepia/50 bg-sand/30 p-4 text-xs text-ink/55">
                    Private contact, birthday, and notes fields are visible only to that person and family administrators.
                  </p>
                )}

                {/* Lineage Info */}
                <div className="bg-sand/30 border border-sepia/50 p-4 rounded-xl space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Heritage Lineage</h4>
                  <p className="text-xs">
                    <strong>Parents: </strong> 
                    {selectedPerson.parentIds && selectedPerson.parentIds.length > 0 
                      ? members.filter(p => selectedPerson.parentIds?.includes(p.id)).map(p => p.name).join(', ') 
                      : 'Eldest Ancestor (No registered parents)'}
                  </p>
                  {getSpouseIds(selectedPerson).length > 0 && (
                    <p className="text-xs">
                      <strong>Spouse: </strong> 
                      {members.filter(p => getSpouseIds(selectedPerson).includes(p.id)).map(p => p.name).join(', ') || 'Linked Spouse'}
                    </p>
                  )}
                  {selectedPerson.childrenIds && selectedPerson.childrenIds.length > 0 && (
                    <p className="text-xs">
                      <strong>Children: </strong> 
                      {members.filter(p => selectedPerson.childrenIds?.includes(p.id)).map(p => p.name).join(', ')}
                    </p>
                  )}
                  {selectedPerson.siblingIds && selectedPerson.siblingIds.length > 0 && (
                    <p className="text-xs">
                      <strong>Siblings: </strong>
                      {members.filter(p => selectedPerson.siblingIds?.includes(p.id)).map(p => p.name).join(', ')}
                    </p>
                  )}
                </div>

                {selectedPerson.safeLocation && (
                  <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-start gap-3">
                    <ShieldCheck size={16} className="text-emerald-700 shrink-0" />
                    <div>
                      <h4 className="text-[9px] font-bold uppercase tracking-wider text-emerald-800">Privacy-filtered location</h4>
                      <p className="text-xs text-emerald-800/75 mt-1">
                        {selectedPerson.safeLocation.city || selectedPerson.safeLocation.emirate || selectedPerson.safeLocation.distanceBand || 'A location summary is available to authorized viewers.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="bg-sand/20 border border-sepia/50 p-4 rounded-xl">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink/40 flex items-center gap-1.5"><Sparkles size={12} className="text-gold" /> Memories</h4>
                  <p className="text-xs text-ink/50 mt-2">Family memories are saved with explicit privacy controls in the Archive and attached to persisted gatherings.</p>
                </div>

                {mutationError && <p role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{mutationError}</p>}
              </div>

              {/* Footer */}
              <div className="p-6 bg-sand border-t border-sepia flex gap-3">
                {(canAdministerFamily || selectedPerson.id === currentUserMemberId) && (
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={saving || !editName.trim()}
                    className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </button>
                )}
                {canAdministerFamily && selectedPerson.id !== currentUserMemberId && (
                  <button 
                    type="button"
                    onClick={() => handleRemoveMember(selectedPerson.id)}
                    disabled={saving}
                    className="bg-red-50 text-red-600 border border-red-200 p-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all flex items-center justify-center gap-1.5"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                )}
                <button 
                  type="button"
                  onClick={() => setSelectedPerson(null)}
                  className="px-6 bg-white border border-sepia text-ink/60 py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:text-ink hover:border-gold transition-all"
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
