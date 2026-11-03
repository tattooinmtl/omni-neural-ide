export const MOODS = [
  'neutral','happy','focused','alert','calm','curious','excited','tired','proud','worried',
  'playful','serious','empathetic','confident','doubtful','inspired','bored','amused','frustrated','patient',
  'eager','reflective','mischievous','supportive','determined','surprised','grateful','nostalgic','vigilant','relaxed',
] as const;
export type Mood = typeof MOODS[number];
export const moodColor: Record<string, number> = {
  neutral:0x1a3040,happy:0x1a4030,focused:0x1a2848,alert:0x402020,calm:0x1a3840,
  curious:0x2a3050,excited:0x403050,tired:0x202030,proud:0x304020,worried:0x403828,
  playful:0x403050,serious:0x182030,empathetic:0x303848,confident:0x204038,doubtful:0x303038,
  inspired:0x384060,bored:0x222830,amused:0x384030,frustrated:0x482028,patient:0x283840,
  eager:0x305040,reflective:0x283050,mischievous:0x403848,supportive:0x204848,determined:0x283858,
  surprised:0x484028,grateful:0x304838,nostalgic:0x383040,vigilant:0x402838,relaxed:0x204040,
};
