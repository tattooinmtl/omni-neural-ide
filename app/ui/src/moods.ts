export const MOODS = [
  'neutral','happy','focused','alert','calm','curious','excited','tired','proud','worried',
  'playful','serious','empathetic','confident','doubtful','inspired','bored','amused','frustrated','patient',
  'eager','reflective','mischievous','supportive','determined','surprised','grateful','nostalgic','vigilant','relaxed',
  'angry','sad','joyful','crying','cold','talking','thinking',
] as const;
export type Mood = typeof MOODS[number];
export type AvatarId = 'female' | 'male';

export const CORE_MOODS = [
  'neutral','surprised','cold','angry','joyful','sad','determined','crying','playful','focused','talking','thinking','frustrated',
] as const;

const NEAREST: Record<string, string> = {
  neutral: 'neutral',
  happy: 'joyful', joyful: 'joyful', excited: 'joyful', proud: 'joyful', grateful: 'joyful', amused: 'joyful',
  focused: 'focused', serious: 'focused', determined: 'determined', confident: 'determined', eager: 'determined', vigilant: 'focused',
  alert: 'surprised', surprised: 'surprised', curious: 'playful',
  calm: 'cold', cold: 'cold', tired: 'cold', bored: 'cold', relaxed: 'cold', patient: 'cold', reflective: 'cold',
  worried: 'sad', sad: 'sad', empathetic: 'sad', doubtful: 'sad', nostalgic: 'sad',
  playful: 'playful', mischievous: 'playful',
  angry: 'angry', frustrated: 'frustrated',
  crying: 'crying',
  inspired: 'determined', supportive: 'playful', talking: 'talking',
  thinking: 'thinking',
};

export function nearestMood(mood: string): string {
  const k = (mood || 'neutral').toLowerCase().trim();
  return NEAREST[k] || 'neutral';
}

export const DIGITAL_FACE_ASSET_VER = '1.3.4';

export function moodPortrait(mood: string, avatar: AvatarId = 'female', faceMode: 'classic' | 'digital' = 'digital'): string {
  const m = nearestMood(mood);
  if (faceMode === 'digital') {
    // versioned lip-free bases only; query busts WebView2 cache
    const file = avatar === 'male' ? 'male.jpg' : 'female.jpg';
    return `/omni-presence/digital/v124/${file}?v=${DIGITAL_FACE_ASSET_VER}`;
  }
  if (avatar === 'male') return `/omni-presence/male/${m}.jpg?v=${DIGITAL_FACE_ASSET_VER}`;
  return `/omni-presence/${m}.jpg?v=${DIGITAL_FACE_ASSET_VER}`;
}

/** Mouth openness frames 0..3 (full portraits). */
export function mouthFrame(level: number, avatar: AvatarId = 'female'): string {
  const n = Math.max(0, Math.min(3, Math.round(level)));
  if (avatar === 'male') return `/omni-presence/male/mouth/${n}.jpg?v=${DIGITAL_FACE_ASSET_VER}`;
  return `/omni-presence/mouth/${n}.jpg?v=${DIGITAL_FACE_ASSET_VER}`;
}

export const moodColor: Record<string, number> = {
  neutral:0x1a3040,happy:0x1a4030,focused:0x1a2848,alert:0x402020,calm:0x1a3840,
  curious:0x2a3050,excited:0x403050,tired:0x202030,proud:0x304020,worried:0x403828,
  playful:0x403050,serious:0x182030,empathetic:0x303848,confident:0x204038,doubtful:0x303038,
  inspired:0x384060,bored:0x222830,amused:0x384030,frustrated:0x482028,patient:0x283840,
  eager:0x305040,reflective:0x283050,mischievous:0x403848,supportive:0x204848,determined:0x283858,
  surprised:0x484028,grateful:0x304838,nostalgic:0x383040,vigilant:0x402838,relaxed:0x204040,
  angry:0x501010,sad:0x203040,joyful:0x204030,crying:0x304050,cold:0x1a2838,talking:0x1a3040,thinking:0x2a3048,
};
