/** Emotes prédéfinies (analyse §1.7) : 6 bulles de BD, puis 3 animations du stickman. */
export const EMOTES = [
  { fr: 'Bien joué !', en: 'Nice one!' },
  { fr: 'Oups', en: 'Oops' },
  { fr: 'Revanche !', en: 'Rematch!' },
  { fr: 'Hé hé', en: 'Hehe' },
  { fr: 'Aïe', en: 'Ouch' },
  { fr: 'GG', en: 'GG' },
  { fr: 'Salut', en: 'Wave' },
  { fr: 'Danse', en: 'Dance' },
  { fr: 'Rire', en: 'Laugh' },
] as const;

export const BUBBLE_EMOTES = 6;
export const EMOTE_COUNT = EMOTES.length;
