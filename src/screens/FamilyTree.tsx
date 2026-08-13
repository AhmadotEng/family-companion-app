import React, { useState } from 'react';
import { FamilyMember, Relationship } from '../types';
import { Plus, Search, Heart, X, Calendar, Phone, Sparkles, UserPlus, Trash2, Users, Share2, Camera, Upload, UserCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { computeTreeLayout, generateConnections } from '../lib/treeLayout';

interface FamilyTreeProps {
  members: FamilyMember[];
  setMembers: React.Dispatch<React.SetStateAction<FamilyMember[]>>;
}

export const getGeneration = (member: FamilyMember): number => {
  if (member.generation !== undefined) return member.generation;
  if (member.relationship === 'Grandparent' || member.familyBranch === 'Elders') return 0;
  if (member.relationship === 'Parent') return 1;
  if (member.relationship === 'Me' || member.id === 'm1') return 2;
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
  onUpload,
  onCamera,
  onAnonymous
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
          <button type="button" onClick={onUpload} className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/70 hover:border-gold hover:text-gold transition-all flex items-center gap-1.5">
            <Upload size={13} /> Upload
          </button>
          <button type="button" onClick={onCamera} className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/70 hover:border-gold hover:text-gold transition-all flex items-center gap-1.5">
            <Camera size={13} /> Camera
          </button>
          <button type="button" onClick={onAnonymous} className="px-3 py-2 bg-white border border-sepia rounded-xl text-[9px] font-bold uppercase tracking-widest text-ink/70 hover:border-gold hover:text-gold transition-all flex items-center gap-1.5">
            <UserCircle size={13} /> Anonymous
          </button>
        </div>
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

export function FamilyTree({ members, setMembers }: FamilyTreeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<FamilyMember | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

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
  const [formRelatedToId, setFormRelatedToId] = useState('m1');
  const [formLinkType, setFormLinkType] = useState('Son');
  const [formBirthday, setFormBirthday] = useState('2000-01-01');
  const [formContact, setFormContact] = useState('');
  const [formBranch, setFormBranch] = useState('Main');
  const [formNotes, setFormNotes] = useState('');
  const [formMemory, setFormMemory] = useState('');
  const [formPhoto, setFormPhoto] = useState('');
  const [formCoParentId, setFormCoParentId] = useState('');
  const [cameraTarget, setCameraTarget] = useState<'add' | 'edit' | null>(null);
  const addPhotoInputRef = React.useRef<HTMLInputElement | null>(null);
  const editPhotoInputRef = React.useRef<HTMLInputElement | null>(null);

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
    if ((formLinkType === 'Son' || formLinkType === 'Daughter') && formSpouseOptions.length > 1) {
      if (!formSpouseOptions.some(spouse => spouse.id === formCoParentId)) {
        setFormCoParentId(formSpouseOptions[0].id);
      }
      return;
    }

    if (formCoParentId) {
      setFormCoParentId('');
    }
  }, [formCoParentId, formLinkType, formSpouseOptions]);

  const readPhotoFile = (file: File, onPhotoReady: (photo: string) => void) => {
    if (!file.type.startsWith('image/')) {
      alert('Please choose an image file.');
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

  const updateSelectedPersonPhoto = (photo: string) => {
    if (!selectedPerson) return;

    setMembers(prev => prev.map(person => (
      person.id === selectedPerson.id ? { ...person, photo } : person
    )));
    setSelectedPerson(prev => prev ? { ...prev, photo } : prev);
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
      updateSelectedPersonPhoto(photo);
    }
  };

  const handleAddMemberSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formRelatedToId) return;

    const relatedPerson = members.find(m => m.id === formRelatedToId);
    if (!relatedPerson) return;

    const relatedGen = getGeneration(relatedPerson);
    let newGen = 2;
    let newRel: Relationship = 'Relative';

    if (formLinkType === 'Father' || formLinkType === 'Mother') {
      newGen = relatedGen - 1;
      newRel = newGen <= 0 ? 'Grandparent' : 'Parent';
    } else if (formLinkType === 'Son' || formLinkType === 'Daughter') {
      newGen = relatedGen + 1;
      newRel = newGen >= 4 ? 'Grandchild' : 'Child';
    } else if (formLinkType === 'Brother' || formLinkType === 'Sister') {
      newGen = relatedGen;
      newRel = 'Relative';
    } else if (formLinkType === 'Spouse') {
      newGen = relatedGen;
      newRel = 'Spouse';
    }

    const newId = `m_added_${Date.now()}`;
    const spouseCandidateIds = getSpouseIds(relatedPerson);
    const selectedCoParentId = formLinkType === 'Son' || formLinkType === 'Daughter'
      ? spouseCandidateIds.length > 1 ? (formCoParentId || spouseCandidateIds[0]) : spouseCandidateIds[0]
      : undefined;
    const relatedSiblingIds = (formLinkType === 'Father' || formLinkType === 'Mother') && relatedPerson.siblingGroupId
      ? members
        .filter(member => member.siblingGroupId === relatedPerson.siblingGroupId)
        .map(member => member.id)
      : [formRelatedToId];
    const siblingGroupId = (formLinkType === 'Brother' || formLinkType === 'Sister') && !(relatedPerson.parentIds?.length)
      ? relatedPerson.siblingGroupId || `sg_${relatedPerson.id}`
      : undefined;
    const existingParentPartner = formLinkType === 'Father' || formLinkType === 'Mother'
      ? relatedPerson.parentIds
        ?.map(parentId => members.find(member => member.id === parentId))
        .find((parent): parent is FamilyMember => Boolean(parent && getGeneration(parent) === newGen))
      : undefined;
    const newPerson: FamilyMember = {
      id: newId,
      name: formName,
      age: 2026 - parseInt(formBirthday.split('-')[0] || '2000'),
      birthday: formBirthday,
      relationship: newRel,
      phone: formContact,
      email: `${formName.toLowerCase().replace(/\s+/g, '')}@family.ae`,
      interests: [],
      locationSharingStatus: 'Inactive',
      photo: formPhoto || createAnonymousAvatar(`${newId}-${formName}`),
      parentIds: [],
      spouseId: undefined,
      spouseIds: [],
      childrenIds: [],
      siblingGroupId,
      familyBranch: formBranch,
      notes: formNotes || undefined,
      memories: formMemory ? [formMemory] : [],
      generation: newGen
    };

    if (formLinkType === 'Father' || formLinkType === 'Mother') {
      newPerson.childrenIds = relatedSiblingIds;
      if (existingParentPartner) {
        newPerson.spouseId = existingParentPartner.id;
        newPerson.spouseIds = [existingParentPartner.id];
      }
    } else if (formLinkType === 'Son' || formLinkType === 'Daughter') {
      newPerson.parentIds = [formRelatedToId];
      if (selectedCoParentId) {
        newPerson.parentIds.push(selectedCoParentId);
      }
    } else if (formLinkType === 'Brother' || formLinkType === 'Sister') {
      newPerson.parentIds = relatedPerson.parentIds || [];
    } else if (formLinkType === 'Spouse') {
      newPerson.spouseId = formRelatedToId;
      newPerson.spouseIds = [formRelatedToId];
      newPerson.childrenIds = [];
    }

    setMembers(prev => {
      return prev.map(person => {
        if ((formLinkType === 'Father' || formLinkType === 'Mother') && relatedSiblingIds.includes(person.id)) {
          return {
            ...person,
            parentIds: addUniqueId(person.parentIds, newId)
          };
        }
        if ((formLinkType === 'Father' || formLinkType === 'Mother') && person.id === existingParentPartner?.id) {
          return {
            ...person,
            spouseId: person.spouseId || newId,
            spouseIds: addUniqueId(person.spouseIds, newId),
            childrenIds: addUniqueIds(person.childrenIds, relatedSiblingIds)
          };
        }
        if (formLinkType === 'Spouse' && person.id === formRelatedToId) {
          return {
            ...person,
            spouseId: person.spouseId || newId,
            spouseIds: addUniqueId(person.spouseIds, newId)
          };
        }
        if ((formLinkType === 'Son' || formLinkType === 'Daughter') && person.id === formRelatedToId) {
          return {
            ...person,
            childrenIds: addUniqueId(person.childrenIds, newId)
          };
        }
        if ((formLinkType === 'Son' || formLinkType === 'Daughter') && selectedCoParentId && person.id === selectedCoParentId) {
          return {
            ...person,
            childrenIds: addUniqueId(person.childrenIds, newId)
          };
        }
        if ((formLinkType === 'Brother' || formLinkType === 'Sister') && siblingGroupId && (person.id === formRelatedToId || person.siblingGroupId === siblingGroupId)) {
          return {
            ...person,
            siblingGroupId
          };
        }
        if ((formLinkType === 'Brother' || formLinkType === 'Sister') && relatedPerson.parentIds?.includes(person.id)) {
          return {
            ...person,
            childrenIds: addUniqueId(person.childrenIds, newId)
          };
        }
        return person;
      }).concat(newPerson);
    });

    setAddModalOpen(false);
    
    // Clear form
    setFormName('');
    setFormRelatedToId('m1');
    setFormLinkType('Son');
    setFormBirthday('2000-01-01');
    setFormContact('');
    setFormBranch('Main');
    setFormNotes('');
    setFormMemory('');
    setFormPhoto('');
    setFormCoParentId('');
  };

  const handleRemoveMember = (memberId: string) => {
    if (memberId === 'm1') {
      alert("You cannot remove yourself ('Ahmed Al Mansouri') as the main family administrator.");
      return;
    }
    const target = members.find(m => m.id === memberId);
    if (!target) return;

    if (confirm(`Are you sure you want to remove ${target.name} from the family lineage and dashboard?`)) {
      setMembers(prev => prev.filter(m => m.id !== memberId).map(m => ({
        ...m,
        parentIds: m.parentIds ? m.parentIds.filter(id => id !== memberId) : [],
        childrenIds: m.childrenIds ? m.childrenIds.filter(id => id !== memberId) : [],
        spouseId: m.spouseId === memberId ? undefined : m.spouseId,
        spouseIds: m.spouseIds ? m.spouseIds.filter(id => id !== memberId) : []
      })));
      setSelectedPerson(null);
    }
  };

  // Tree Layout Computation
  const X_SPACING = 280;
  const Y_SPACING = 180;
  
  const layoutNodes = React.useMemo(() => computeTreeLayout(members), [members]);
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
            <h3 className="text-4xl font-serif italic text-ink tracking-wide">Ahmed Al Mansouri</h3>
            <div className="w-16 h-px bg-sepia mx-auto mt-4 opacity-50 border-t border-dashed"></div>
          </div>
          <div className="flex gap-3 w-full max-w-lg justify-center">
            <button 
              onClick={() => setAddModalOpen(true)}
              className="bg-ink text-white px-6 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg hover:bg-gold transition-colors"
            >
              <Plus size={16} /> Add relative
            </button>
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

      <button 
        onClick={() => alert("Digital family tree link generated: 'https://familytree.mansouri.ae/share/f1'. Copied to clipboard! Send to WhatsApp groups to let cousins join.")}
        className="flex items-center justify-center gap-3 text-gold text-[10px] uppercase font-bold tracking-[0.2em] py-6 hover:text-ink transition-colors"
      >
        <Share2 size={16} /> Share tree with extended family
      </button>

      {/* Add Relative Modal */}
      <AnimatePresence>
        {addModalOpen && (
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
                        <option key={person.id} value={person.id}>{person.name} ({person.id === 'm1' ? 'Me' : person.relationship})</option>
                      ))}
                    </select>
                  </div>

                  {/* Type of Link */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Type of Link (Lineage Connection)</label>
                    <select
                      value={formLinkType}
                      onChange={(e) => setFormLinkType(e.target.value)}
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

                  {(formLinkType === 'Son' || formLinkType === 'Daughter') && formSpouseOptions.length > 1 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Other Parent</label>
                      <select
                        value={formCoParentId || formSpouseOptions[0].id}
                        onChange={(e) => setFormCoParentId(e.target.value)}
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-gold text-sm text-ink"
                      >
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

                  {/* Branch & Notes */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-wider block">Family Branch</label>
                      <input 
                        type="text"
                        value={formBranch}
                        onChange={(e) => setFormBranch(e.target.value)}
                        placeholder="e.g. Elders, Main, Uncle Zayed Branch"
                        className="w-full bg-sand/30 border border-sepia rounded-xl px-3 py-2 focus:outline-none text-xs"
                      />
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

                  {/* Memory */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider block">Heritage Memory (Family Story)</label>
                    <textarea 
                      value={formMemory}
                      onChange={(e) => setFormMemory(e.target.value)}
                      placeholder="e.g. Shares details of pearl trading routes in historical meetings."
                      rows={2}
                      className="w-full bg-sand/30 border border-sepia rounded-xl px-4 py-2 focus:outline-none text-xs resize-none"
                    />
                  </div>
                </div>

                {/* Footer */}
                <div className="p-6 bg-sand border-t border-sepia flex gap-4">
                  <button 
                    type="submit"
                    className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow"
                  >
                    Add to Lineage
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
                      {selectedPerson.relationship === 'Me' ? 'Me (Admin)' : selectedPerson.relationship}
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

                {/* Details list */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-xs">
                    <Calendar size={14} className="text-gold" />
                    <span className="font-bold uppercase text-[9px] text-ink/40 tracking-wider">Birthday:</span>
                    <span>{selectedPerson.birthday}</span>
                  </div>
                  {selectedPerson.phone && (
                    <div className="flex items-center gap-3 text-xs">
                      <Phone size={14} className="text-gold" />
                      <span className="font-bold uppercase text-[9px] text-ink/40 tracking-wider">Contact:</span>
                      <span>{selectedPerson.phone}</span>
                    </div>
                  )}
                </div>

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
                </div>

                {/* Notes */}
                {selectedPerson.notes && (
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Notes</h4>
                    <p className="font-serif italic text-ink/70 bg-sand/20 border-l-2 border-gold pl-3 py-1">{selectedPerson.notes}</p>
                  </div>
                )}

                {/* Memories */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-ink/40 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-gold" />
                    Heritage Stories & Memories
                  </h4>
                  {selectedPerson.memories && selectedPerson.memories.length > 0 ? (
                    <div className="space-y-2">
                      {selectedPerson.memories.map((memory, index) => (
                        <div key={index} className="bg-sand/30 p-4 rounded-xl border border-sepia/30 font-serif italic text-xs leading-relaxed">
                          "{memory}"
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center bg-sand/10 border border-sepia/30 py-6 rounded-xl">
                      <p className="text-xs italic text-ink/40 font-serif">No stories recorded yet.</p>
                      <button 
                        type="button"
                        onClick={() => {
                          const story = prompt("Type a story or memory of this person to preserve:");
                          if (story) {
                            setMembers(prev => prev.map(person => {
                              if (person.id === selectedPerson.id) {
                                return {
                                  ...person,
                                  memories: [...(person.memories || []), story]
                                };
                              }
                              return person;
                            }));
                            setSelectedPerson({
                              ...selectedPerson,
                              memories: [...(selectedPerson.memories || []), story]
                            });
                          }
                        }}
                        className="text-[9px] font-bold text-gold uppercase mt-2 hover:underline"
                      >
                        + Write First Story
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 bg-sand border-t border-sepia flex gap-3">
                <button 
                  type="button"
                  onClick={() => {
                    const story = prompt("Type a family story, heritage fact, or memory of this relative to preserve in lineage logs:");
                    if (story) {
                      setMembers(prev => prev.map(person => {
                        if (person.id === selectedPerson.id) {
                          return {
                            ...person,
                            memories: [...(person.memories || []), story]
                          };
                        }
                        return person;
                      }));
                      setSelectedPerson({
                        ...selectedPerson,
                        memories: [...(selectedPerson.memories || []), story]
                      });
                    }
                  }}
                  className="flex-1 bg-ink text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gold transition-colors text-center shadow"
                >
                  Preserve Story
                </button>
                {selectedPerson.id !== 'm1' && (
                  <button 
                    type="button"
                    onClick={() => handleRemoveMember(selectedPerson.id)}
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
