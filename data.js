/*
 * data.js - ALL the words and numbers in the app live here.
 * You can edit the text between the quote marks without touching any other file.
 * (Keep the quote marks, commas and brackets exactly as they are.)
 */
(function (root) {
  'use strict';

  var D = {};

  D.TITLE = "Mike's Hybrid Strength, Balance & Mobility Program (Age 50+)";
  D.SHORT_TITLE = "Mike's Program";
  D.STORAGE_PREFIX = 'mikeExercise.';
  D.STOP_LINE = 'Stop immediately if experiencing chest pain, unusual shortness of breath, dizziness, or sharp pain.';
  D.DISCLAIMER = 'Consult your physician before beginning any exercise program.';
  D.CONSENT_LABEL = 'I have talked with my physician about starting this program.';
  D.REST_NOTE = 'Rest as needed between rounds.';
  D.STRETCH_NOTE = 'Stretch to mild tension, never pain. Never bounce.';
  D.SUPPORT_NOTE = 'Hold a chair or counter for the standing moves.';
  D.WAKE_NOTE = 'Keep your screen on during workouts.';
  D.TAICHI_FEEL = 'Move as if floating through water: smooth, relaxed, never forced.';
  D.WEEK_PASSED = 'A week has passed. Ready to move up or repeat?';
  D.REPEAT_NOTE = 'If any box is unchecked, repeat the week. That is smart training, not falling behind.';
  D.BACKUP_NOTE = 'Your progress is saved only on this iPhone, and clearing Safari data can erase it, so back up now and then.';

  /* Safety screen (opened by the Safety button on every screen) */
  D.SAFETY = {
    title: 'Safety',
    points: [
      'Consult your physician before beginning any exercise program.',
      'Use a sturdy chair without wheels, placed against a wall, and hold a counter or chair back for standing moves.',
      'You should be able to talk comfortably while you exercise.',
      'Stretch to mild tension, never pain. Never bounce.',
      'Breathe steadily. Never hold your breath.',
      'If you feel unwell, stop and rest. If symptoms are severe or do not ease, call your local emergency number.'
    ]
  };

  /* Days, Monday first. cooldown = does the day end with the 5-minute cool-down? */
  D.DAYS = [
    { key: 'mon', name: 'Monday',    short: 'Mon', plan: 'Strength A',               kind: 'strengthA', cooldown: true },
    { key: 'tue', name: 'Tuesday',   short: 'Tue', plan: 'Chair Tai Chi + Mobility', kind: 'mobility',  cooldown: false },
    { key: 'wed', name: 'Wednesday', short: 'Wed', plan: 'Walking Day',              kind: 'walking',   cooldown: true },
    { key: 'thu', name: 'Thursday',  short: 'Thu', plan: 'Strength B',               kind: 'strengthB', cooldown: true },
    { key: 'fri', name: 'Friday',    short: 'Fri', plan: 'Chair Tai Chi',            kind: 'taichi',    cooldown: false },
    { key: 'sat', name: 'Saturday',  short: 'Sat', plan: 'Active Adventure Day',     kind: 'adventure', cooldown: true },
    { key: 'sun', name: 'Sunday',    short: 'Sun', plan: 'Recovery Day',             kind: 'recovery',  cooldown: false }
  ];

  /* Daily Warm-Up (7 minutes). type: timed | reps | breath */
  D.WARMUP = {
    title: 'Daily Warm-Up',
    minutes: 7,
    steps: [
      { id: 'march',    name: 'March in Place',   type: 'timed', seconds: 120, label: '2 minutes',
        coach: 'Lift your knees comfortably and swing your arms at an easy, steady pace.',
        tip: 'You may march seated if balance feels off.' },
      { id: 'shoulder', name: 'Shoulder Rolls',   type: 'reps', label: '10 forward, then 10 backward',
        coach: 'Roll big and slow: up, back, and down; keep your neck relaxed.' },
      { id: 'arms',     name: 'Arm Circles',      type: 'reps', label: '10 forward, then 10 backward',
        coach: 'Make big, smooth circles with relaxed arms; keep your shoulders down.' },
      { id: 'hips',     name: 'Hip Circles',      type: 'reps', label: '10 each direction',
        coach: 'Hold a chair or counter; draw slow, easy circles with your hips.' },
      { id: 'ankles',   name: 'Ankle Circles',    type: 'reps', label: '10 each ankle',
        coach: 'Hold a chair or counter; lift one foot and circle the ankle slowly.' },
      { id: 'toes',     name: 'Toe Raises',       type: 'reps', label: '10 raises',
        coach: 'Hold a chair or counter; lift your toes, keep heels down, and lower slowly.' },
      { id: 'heels',    name: 'Heel Raises',      type: 'reps', label: '10 raises',
        coach: 'Hold a chair or counter; rise onto your toes, pause, then lower slowly.' },
      { id: 'breath',   name: 'Deep Breathing',   type: 'breath', breaths: 5, inSec: 4, outSec: 6, label: '5 slow breaths',
        coach: 'Breathe in through your nose for 4, then out slowly for 6.' }
    ]
  };

  /* Stretch tips, used by Tuesday and the cool-down */
  D.STRETCH_TIPS = {
    neck:      'Ear toward shoulder, never pull.',
    chest:     'Hands clasped behind your back, gently squeeze shoulder blades, lift your chest.',
    hip:       'Seated, ankle on the opposite knee, sit tall, hinge slightly forward.',
    hamstring: 'Edge of a chair, one leg straight, heel down, toes up, hinge from the hips with a flat back.',
    calf:      'Hands on a wall, one foot back with the heel down, bend the front knee.',
    upperBack: 'Clasp hands in front and reach forward, rounding your upper back.'
  };

  /* 5-Minute Recovery Cool-Down. sides = do both sides. */
  D.COOLDOWN = {
    title: '5-Minute Recovery Cool-Down',
    steps: [
      { id: 'walk',     name: 'Slow Walk',        type: 'timed', seconds: 120, label: '2 minutes',
        coach: 'Walk slowly and let your breathing settle.' },
      { id: 'calf',     name: 'Calf Stretch',     type: 'sides', seconds: 30, label: '30 seconds each side',
        coach: D.STRETCH_TIPS.calf },
      { id: 'hamstring', name: 'Hamstring Stretch', type: 'sides', seconds: 30, label: '30 seconds each side',
        coach: D.STRETCH_TIPS.hamstring },
      { id: 'chest',    name: 'Chest Stretch',    type: 'timed', seconds: 30, label: '30 seconds',
        coach: D.STRETCH_TIPS.chest },
      { id: 'upperBack', name: 'Upper Back Stretch', type: 'timed', seconds: 30, label: '30 seconds',
        coach: D.STRETCH_TIPS.upperBack },
      { id: 'breath',   name: 'Deep Breathing',   type: 'breath', breaths: 5, inSec: 4, outSec: 6, label: '5 slow breaths',
        coach: 'Breathe in through your nose for 4, then out slowly for 6.' }
    ]
  };

  /* Tuesday stretches. sides = both sides where it applies. Hold time is chosen by the user. */
  D.STRETCHES = [
    { id: 'neck',      name: 'Neck Stretch',      sides: true,  coach: D.STRETCH_TIPS.neck },
    { id: 'chest',     name: 'Chest Stretch',     sides: false, coach: D.STRETCH_TIPS.chest },
    { id: 'hip',       name: 'Hip Stretch',       sides: true,  coach: D.STRETCH_TIPS.hip },
    { id: 'hamstring', name: 'Hamstring Stretch', sides: true,  coach: D.STRETCH_TIPS.hamstring }
  ];
  D.STRETCH_HOLDS = [20, 25, 30];
  D.STRETCH_HOLD_DEFAULT = 30;

  /* Strength days. Each round = one circuit of these five exercises. */
  D.STRENGTH = {
    A: {
      title: 'Strength A',
      exercises: [
        { id: 'squat',  name: 'Chair Squats',         reps: '× 10',
          tip: 'Chair against a wall; hips back until you lightly touch the seat; reach arms forward; breathe out as you stand.' },
        { id: 'pushup', name: 'Wall Push-Ups',        reps: '× 10',
          tip: "Arm's length from the wall; body in a straight line; stand closer for less effort." },
        { id: 'calf',   name: 'Standing Calf Raises', reps: '× 15',
          tip: 'Hold a counter or chair back; rise slowly, pause, lower slowly.' },
        { id: 'stepup', name: 'Step-Ups',             reps: '× 10 each leg',
          tip: 'Low sturdy step; always hold a rail or counter; finish all reps on one leg, then switch.' },
        { id: 'plank',  name: 'Countertop Plank',     reps: '× 20 seconds', holdSeconds: 20,
          tip: 'Hands on a fixed sturdy counter; straight slanted line; keep breathing.' }
      ]
    },
    B: {
      title: 'Strength B',
      exercises: [
        { id: 'sit',    name: 'Sit-to-Stand',         reps: '× 10',
          tip: 'Sit near the front edge; nose over toes; lower slowly over about 3 seconds.' },
        { id: 'pushup', name: 'Wall Push-Ups',        reps: '× 12',
          tip: "Arm's length from the wall; body in a straight line; stand closer for less effort." },
        { id: 'lunge',  name: 'Supported Lunges',     reps: '× 8 each side',
          tip: 'Hold the counter the whole time; short step; shallow is fine.' },
        { id: 'bird',   name: 'Bird Dog (supported)', reps: '× 8 each side',
          tip: 'Hands on a counter, hinge until your back is flat, slide one leg straight back keeping hips level; reach the opposite arm only when steady. Floor version only if comfortable getting down to and up from the floor, with a sturdy chair beside you.' },
        { id: 'knee',   name: 'Standing Knee Raises', reps: '× 10 each side',
          tip: "Hold support; don't lean back." }
      ]
    }
  };
  D.REST_CHOICES = [30, 60];

  /* Progression: what Today shows depends on the current week. */
  D.PROGRESSION = [
    { from: 1, to: 2, weeks: 'Weeks 1–2', rounds: 1, optionalRounds: 0, roundsLabel: '1 round',                  taiChi: 15 },
    { from: 3, to: 4, weeks: 'Weeks 3–4', rounds: 2, optionalRounds: 0, roundsLabel: '2 rounds',                 taiChi: 20 },
    { from: 5, to: 6, weeks: 'Weeks 5–6', rounds: 2, optionalRounds: 1, roundsLabel: '2 to 3 rounds',            taiChi: 25 },
    { from: 7, to: 8, weeks: 'Weeks 7–8', rounds: 3, optionalRounds: 0, roundsLabel: '3 rounds',                 taiChi: 30 }
  ];
  D.OPTIONAL_ROUND_LABEL = 'Optional: add when you feel strong and steady';
  D.PROGRESSION_NOTES = [
    "One circuit means one round of that day's five exercises.",
    "Chair Tai Chi minutes apply to Friday's main session. Tuesday stays 15 to 20 minutes, and Monday's finish stays 5 minutes.",
    'Walking, Adventure, and Recovery days stay the same all eight weeks.',
    'When 10 wall push-ups or chair squats feel easy, add 1 to 2 reps at a time toward 15.'
  ];

  /* "Ready to Move Up?" checkboxes */
  D.READY_TO_MOVE_UP = [
    "Last week's workouts felt comfortable, with no sharp or lingering pain",
    'I could talk comfortably during exercise',
    'My form stayed smooth and controlled',
    'I recovered well before my next session'
  ];

  /* 8-Week Success Targets.
   * NOTE: these five lines are a first draft - please replace them with the wording
   * from your printed program. */
  D.SUCCESS_TARGETS = [
    'I completed most of my planned workout days each week',
    'I can do 15 wall push-ups or chair squats comfortably',
    'I can walk briskly for 30 minutes and still talk',
    'I can do 30 minutes of Chair Tai Chi smoothly and steadily',
    'I feel stronger, steadier and more confident in everyday movement'
  ];

  D.CONGRATS = {
    title: 'Congratulations, you finished the 8-week program!',
    text: 'That is a real achievement. Your Week 8 settings stay in place, so you can keep going at this level, or go back a week if you would like an easier pace.'
  };

  /* Tuesday / Wednesday / Friday / Sunday choices */
  D.TUESDAY_TAICHI_CHOICES = [15, 20];
  D.WALK = { min: 20, max: 40, step: 5, defaultMinutes: 30,
    note: 'Brisk means you could talk but not sing.' };
  D.WED_TAICHI_CHOICES = [0, 5, 6, 7, 8, 9, 10];       /* 0 = skip */
  D.ADVENTURES = ['Walking', 'Hiking', 'Gardening', 'Cycling', 'Swimming', 'Other'];
  D.ADVENTURE_GOAL = 'Goal: 30 to 60 minutes.';
  D.RECOVERY = {
    items: ['Gentle Stretching', 'Easy Walking', 'Deep Breathing'],
    goal: 'Take 10 to 20 minutes, at an easy pace.',
    timerChoices: [10, 15, 20],
    defaultMinutes: 15
  };
  D.FRIDAY_FOCUS = [
    { id: 'posture',      name: 'Posture' },
    { id: 'breathing',    name: 'Breathing' },
    { id: 'weightshift',  name: 'Weight Shifting' },
    { id: 'balance',      name: 'Balance' },
    { id: 'coordination', name: 'Coordination' }
  ];

  /* Chair Tai Chi */
  D.TAICHI = {
    setup: [
      'Use a sturdy chair without wheels, placed against a wall.',
      'Sit toward the front edge, feet flat and hip-width apart.',
      'Sit tall with shoulders relaxed.',
      'Breathe through the nose and never hold your breath.'
    ],
    /* The base flow. Minutes here are for the 15-minute session; other lengths are scaled from it. */
    base: [
      { id: 'settle', name: 'Settling Breath',        minutes: 2,
        cue: 'Hands on thighs; in through the nose as your belly expands, out slowly as shoulders soften.' },
      { id: 'arms',   name: 'Rising & Sinking Arms',  minutes: 2,
        cue: 'In as arms float up to shoulder height, palms down; out as palms lower to thighs.' },
      { id: 'push',   name: 'Push & Pull',            minutes: 2,
        cue: 'Out as palms push slowly forward; in as hands draw back to your chest.' },
      { id: 'cloud',  name: 'Cloud Hands',            minutes: 2,
        cue: 'Imaginary ball at your right hip; turn gently from the waist to the left as hands roll across; then reverse.' },
      { id: 'shift',  name: 'Seated Weight Shifts',   minutes: 2,
        cue: 'Feel both sit bones; shift onto the right, then the left.' },
      { id: 'march',  name: 'Opposite-Arm March',     minutes: 2,
        cue: 'March slowly seated; swing the opposite arm forward.' },
      { id: 'stand',  name: 'Supported Standing Shift', minutes: 2,
        cue: 'Stand behind a sturdy chair, hands on its back; shift weight onto the right foot, then the left; only when steady.' },
      { id: 'close',  name: 'Closing Breaths',        minutes: 1,
        cue: 'Slow and easy.' }
    ],
    /* The 5-minute finish (Monday) uses fixed lengths, in minutes. */
    finish5: [
      { ref: 'settle', minutes: 1 },
      { ref: 'arms',   minutes: 2 },
      { ref: 'cloud',  minutes: 2 }
    ]
  };

  root.EXERCISE_DATA = D;
})(window);
