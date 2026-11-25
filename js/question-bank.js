// Ready-made dating questions. Creators pick which answers they'd accept,
// so none of these has a "right" answer built in.

export const CATEGORIES = [
  {
    id: 'intentions',
    name: 'Intentions',
    questions: [
      { prompt: 'What are you looking for right now?', options: ['A serious relationship', 'Something that could become serious', 'Something casual', 'Not sure yet'] },
      { prompt: 'If things go well, when would you want to get married?', options: ['Within 1–2 years', 'In 3–5 years', 'No rush', 'I don’t plan to marry'] },
      { prompt: 'Do you want children?', options: ['Yes', 'Maybe someday', 'No', 'I already have children'] },
      { prompt: 'Could a long-distance relationship work for you?', options: ['Yes', 'For a while', 'No'] },
    ],
  },
  {
    id: 'faith',
    name: 'Faith & values',
    questions: [
      { prompt: 'Do you have a personal relationship with God?', options: ['Yes', 'I’m exploring', 'No'] },
      { prompt: 'How important is faith or religion in your day-to-day life?', options: ['Central to my life', 'Important, but private', 'Not very', 'Not at all'] },
      { prompt: 'How do you see roles in a relationship?', options: ['Equal partners in everything', 'Equal, with some traditional roles', 'Mostly traditional roles'] },
      { prompt: 'How involved should family be in a relationship?', options: ['Very involved', 'Involved, with boundaries', 'Mostly private'] },
    ],
  },
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    questions: [
      { prompt: 'How do you feel about vaping or smoking?', options: ['I do it regularly', 'Occasionally', 'Never, and I’d rather a partner didn’t', 'Never, but I don’t mind'] },
      { prompt: 'How often do you drink alcohol?', options: ['Never', 'Socially', 'Most weekends', 'Often'] },
      { prompt: 'How does fitness fit into your life?', options: ['Gym or sport most days', 'A few times a week', 'When I can', 'It’s not for me'] },
      { prompt: 'What’s your relationship with food?', options: ['I live to eat', 'I love trying new places', 'Food is fuel', 'I’m a picky eater'] },
      { prompt: 'How do you feel about slow, quiet days with nothing planned?', options: ['I love them', 'Fine now and then', 'I get restless'] },
      { prompt: 'Your ideal Friday night?', options: ['Out with friends', 'Dinner for two', 'Home with a show', 'Depends on the week'] },
    ],
  },
  {
    id: 'love',
    name: 'Love & connection',
    questions: [
      { prompt: 'Would you call yourself a romantic?', options: ['Very', 'A little', 'Not really'] },
      { prompt: 'When a disagreement happens, what do you usually do?', options: ['Talk it out calmly, right away', 'Take some space, then talk', 'Let it go and move on', 'It depends'] },
      { prompt: 'How do you most like to show love?', options: ['Kind words', 'Quality time', 'Gifts', 'Doing things for them', 'Physical affection'] },
      { prompt: 'How do you feel about planning surprises for a partner?', options: ['I love it', 'Now and then', 'Not really my thing'] },
      { prompt: 'How often do you like to talk or text when you’re apart?', options: ['Throughout the day', 'Once or twice a day', 'Every few days is fine'] },
    ],
  },
  {
    id: 'life',
    name: 'Work & money',
    questions: [
      { prompt: 'How do you feel about your job or career right now?', options: ['I love it', 'It’s good for now', 'I’m working towards something else', 'I’m between things'] },
      { prompt: 'How should a couple handle money?', options: ['Split things evenly', 'Whoever earns more pays more', 'One shared pot', 'Work it out together'] },
      { prompt: 'Where do you see yourself living in five years?', options: ['The same city', 'Another city in my country', 'Abroad', 'Wherever life takes me'] },
    ],
  },
  {
    id: 'fun',
    name: 'Just for fun',
    questions: [
      { prompt: 'Do you have a favourite TV show?', options: ['Yes, and I’ll make you watch it', 'I watch a bit of everything', 'I barely watch TV'] },
      { prompt: 'Pick a perfect holiday', options: ['Beach and rest', 'A new city to explore', 'Adventure outdoors', 'Visiting family'] },
    ],
  },
];

// A sensible first set for "Start with a ready-made set".
export const STARTER_PROMPTS = [
  'What are you looking for right now?',
  'Do you want children?',
  'How important is faith or religion in your day-to-day life?',
  'When a disagreement happens, what do you usually do?',
  'How do you feel about vaping or smoking?',
  'How does fitness fit into your life?',
  'Would you call yourself a romantic?',
  'How should a couple handle money?',
];

export function findBankQuestion(prompt) {
  for (const c of CATEGORIES) {
    const q = c.questions.find((x) => x.prompt === prompt);
    if (q) return q;
  }
  return null;
}
