import type { EquipmentSlug, ExerciseCreate, MuscleSlug, TrackingMode } from '@cedo/contract'
import type { z } from 'zod'

/**
 * The starter library, owned by the seeded `cedo` group and readable by every user.
 *
 * Muscle loads are a percentage of total load and must sum to 100 — `seed.ts` validates every
 * entry against `ExerciseCreate` before writing, so a typo here fails the seed rather than
 * producing a silently wrong library.
 *
 * What it holds is what evidence-based hypertrophy and strength programs ask for — the Big Six
 * patterns, an isolation lift for every muscle that needs one, and the machine and cable
 * variations those programs are written around. Where two exercises for one muscle differ in where
 * they are hardest — at long lengths, which grows muscle best, or short — the description says so.
 * A NAME, once shipped, is permanent: the seed finds an entry by it, so renaming one makes a second
 * copy on every installation. And the seed only inserts what is missing (see `seedExercise`): an
 * entry's text changed here reaches new installations, never the library of an existing one.
 */
export interface SeedExercise {
  readonly name: string
  readonly tracking?: TrackingMode
  /** What it needs, all of it — `[]` nothing. See `describeEntry` in seed.ts. */
  readonly equipment: readonly EquipmentSlug[]
  readonly isUnilateral?: boolean
  /** What it trains and why you would pick it over its neighbours. */
  readonly description: string
  /** How to do it: setup, then the cues that matter, one line each. */
  readonly instructions: string
  /**
   * A YouTube demonstration, as `https://www.youtube.com/watch?v=<id>` — checked to exist when it
   * was chosen. Left out, the entry links a YouTube search for its name instead (see seed.ts).
   */
  readonly video?: string
  readonly muscles: readonly (readonly [MuscleSlug, number])[]
}

/**
 * An entry as `ExerciseCreate` reads it. One mapping for the seed and the library's own test, so a
 * field added here cannot reach one and not the other — as `instructions` once reached neither.
 */
export const exerciseInputOf = (entry: SeedExercise): z.input<typeof ExerciseCreate> => ({
  name: entry.name,
  tracking: entry.tracking ?? 'weight_reps',
  description: entry.description,
  instructions: entry.instructions,
  equipment: [...entry.equipment],
  isUnilateral: entry.isUnilateral ?? false,
  muscles: entry.muscles.map(([muscle, loadPct]) => ({ muscle, loadPct })),
})

/** Numbered, so a step that wraps on a phone still reads as one step. */
const steps = (...lines: readonly string[]): string =>
  lines.map((line, i) => `${i + 1}. ${line}`).join('\n')

export const EXERCISE_LIBRARY: readonly SeedExercise[] = [
  // ---- squat pattern ----
  {
    name: 'Barbell Back Squat',
    video: 'https://www.youtube.com/watch?v=1oed-UmAxFs',
    equipment: ['barbell', 'rack'],
    description:
      'Bar on the upper back, squat to depth and drive up. The reference lower-body lift for quads, glutes and adductors.',
    instructions: steps(
      'Set the bar at armpit height. High-bar sits on the upper traps; low-bar a few inches lower, on the rear delts.',
      'Hands just outside the shoulders, unrack, and take two or three steps back at most.',
      'Feet at least shoulder width, toes slightly out, bar over mid-foot.',
      'Sit the hips back and down as deep as you can without the lower back rounding much.',
      'Drive up, keeping the bar over mid-foot; breathe out halfway up.',
    ),
    muscles: [
      ['quadriceps', 45],
      ['gluteus_maximus', 30],
      ['erector_spinae', 10],
      ['adductors', 10],
      ['hamstrings', 5],
    ],
  },
  {
    name: 'Front Squat',
    video: 'https://www.youtube.com/watch?v=1g0sh_6K7AU',
    equipment: ['barbell', 'rack'],
    description:
      'Bar racked on the front delts. More upright than a back squat, so more quad and trunk, and usually deeper.',
    instructions: steps(
      'Rack the bar on the front delts: two fingers under the bar, arms crossed, or straps.',
      'Keep the upper arms parallel to the floor and the torso upright throughout.',
      'Squat deeper than you would with a back squat, then drive straight up.',
    ),
    muscles: [
      ['quadriceps', 55],
      ['gluteus_maximus', 20],
      ['erector_spinae', 15],
      ['rectus_abdominis', 10],
    ],
  },
  {
    name: 'Hack Squat',
    video: 'https://www.youtube.com/watch?v=VY8ko6ecfso',
    equipment: ['hack_squat'],
    description:
      'Machine squat with the back supported, so the quads can be pushed hard without the trunk limiting the set. Hardest at the bottom.',
    instructions: steps(
      'Back and shoulders flat on the pads, feet mid-platform at about shoulder width.',
      'Lower under control as deep as the hips stay on the pad.',
      'Drive up without locking out hard; keep tension on the quads.',
    ),
    muscles: [
      ['quadriceps', 60],
      ['gluteus_maximus', 25],
      ['adductors', 15],
    ],
  },
  {
    name: 'Smith Machine Squat',
    video: 'https://www.youtube.com/watch?v=8TEK4DPVVPs',
    equipment: ['smith_machine'],
    description:
      'Squat on a fixed bar path. Feet forward shifts load to the glutes, under the bar to the quads. A stand-in for a hack squat.',
    instructions: steps(
      'Bar on the upper back, feet slightly in front of the bar.',
      'Unhook, squat as deep as the lower back stays neutral, and drive up.',
      'Keep the same foot position every session so loads compare.',
    ),
    muscles: [
      ['quadriceps', 55],
      ['gluteus_maximus', 30],
      ['adductors', 10],
      ['hamstrings', 5],
    ],
  },
  {
    name: 'Bulgarian Split Squat',
    video: 'https://www.youtube.com/watch?v=iwV9rTHKrOg',
    equipment: ['dumbbells', 'flat_bench'],
    isUnilateral: true,
    description:
      "Rear foot elevated, one leg at a time. Deep stretch on the front leg's glute and quad. Weight shown is per side.",
    instructions: steps(
      'Rear foot laces-down on a bench, front foot far enough forward that the knee can bend freely.',
      'Lower until the rear knee nearly touches the floor; torso upright for quads, a slight lean for glutes.',
      'Drive through the front foot. Start with the weaker leg and match its reps on the other.',
    ),
    muscles: [
      ['quadriceps', 40],
      ['gluteus_maximus', 35],
      ['adductors', 15],
      ['hamstrings', 10],
    ],
  },
  {
    name: 'Dumbbell Lunge',
    video: 'https://www.youtube.com/watch?v=_qSuiZ62vqI',
    equipment: ['dumbbells'],
    isUnilateral: true,
    description:
      'Walking or reverse lunge with a dumbbell in each hand. Quads and glutes, one leg at a time. Weight shown is per side.',
    instructions: steps(
      'Medium strides. Lower until the rear knee soft-touches the floor, torso upright.',
      'Drive through the front leg and keep the back leg from doing the work.',
      'Walking lunges alternate legs; step backwards instead (reverse lunge) if balance is an issue.',
      'Use straps when grip gives out before the legs.',
    ),
    muscles: [
      ['quadriceps', 40],
      ['gluteus_maximus', 40],
      ['adductors', 15],
      ['hamstrings', 5],
    ],
  },
  {
    name: 'Leg Press',
    video: 'https://www.youtube.com/watch?v=K4_6lWell1E',
    equipment: ['leg_press'],
    description:
      'Machine squat pattern with the trunk supported. Low feet bias the quads, high feet the glutes, wide feet the adductors.',
    instructions: steps(
      'Feet shoulder width on the platform; place them low for quads, high for glutes.',
      'Lower as deep as you can while the lower back and pelvis stay on the pad.',
      'Press up; locking the knees under control is fine.',
    ),
    muscles: [
      ['quadriceps', 55],
      ['gluteus_maximus', 30],
      ['hamstrings', 10],
      ['adductors', 5],
    ],
  },
  {
    name: 'Goblet Squat',
    video: 'https://www.youtube.com/watch?v=Xjo_fY9Hl9w',
    equipment: ['dumbbells'],
    description:
      'Weight held at the chest. Self-correcting technique, so the best squat to learn on; outgrown once the dumbbell gets awkward to hold.',
    instructions: steps(
      'Hold one dumbbell vertically against the chest, elbows under it.',
      'Squat between the knees, at least as deep as a front squat, torso upright.',
      'Drive up through the whole foot.',
    ),
    muscles: [
      ['quadriceps', 45],
      ['gluteus_maximus', 30],
      ['rectus_abdominis', 15],
      ['adductors', 10],
    ],
  },
  {
    name: 'Leg Extension',
    video: 'https://www.youtube.com/watch?v=gI0cn4DMFFI',
    equipment: ['leg_extension'],
    description:
      'Isolated knee extension. With the seat reclined it is one of the few exercises that loads the rectus femoris at length.',
    instructions: steps(
      'Set the seat all the way back and the pad just above the ankles.',
      'Set the machine for the biggest stretch at the bottom.',
      'Hold the handles to keep the hips down, extend to lockout, and lower under control.',
    ),
    muscles: [['quadriceps', 100]],
  },
  {
    name: 'Sissy Squat',
    video: 'https://www.youtube.com/watch?v=r7ezSWy69Hc',
    equipment: [],
    tracking: 'bodyweight_reps',
    description:
      'Knees travel far forward as the body leans back: a deep quad stretch, the rectus femoris most, with no machine.',
    instructions: steps(
      'Hold something fixed for balance, feet hip width, up on the balls of the feet.',
      'Push the knees forward and lean back, body straight from knees to head, as low as you can control.',
      'Drive back up through the quads. Hold a plate at the chest to load it.',
    ),
    muscles: [
      ['quadriceps', 90],
      ['hip_flexors', 10],
    ],
  },
  {
    name: 'Reverse Nordic',
    video: 'https://www.youtube.com/watch?v=TOe2ZzzkuOA',
    equipment: [],
    tracking: 'bodyweight_reps',
    description:
      'Kneeling lean-back that stretches the quads, the rectus femoris most, under bodyweight. A leg extension stand-in with no machine.',
    instructions: steps(
      'Kneel on a pad, feet anchored, body straight from knees to head.',
      'Lean back from the knees only, hips locked, as far as you can control.',
      'Return by squeezing the quads. Shorten the range at first and add depth week by week.',
    ),
    muscles: [
      ['quadriceps', 90],
      ['hip_flexors', 10],
    ],
  },

  // ---- hinge pattern ----
  {
    name: 'Conventional Deadlift',
    video: 'https://www.youtube.com/watch?v=uSdwYWtj8fA',
    equipment: ['barbell'],
    description:
      'Pull from the floor with a neutral spine. Loads the whole posterior chain; mostly a strength lift, costly to recover from.',
    instructions: steps(
      'Feet hip width, bar over mid-foot, shins about an inch away.',
      'Hinge down, grip just outside the legs: double overhand, alternate, or straps.',
      'Pull the slack out of the bar before it leaves the floor — no grip-and-rip.',
      'Keep the bar against the shins and thighs; breathe out once past the knees.',
      'Hold lockout a second without leaning back, lower straight down, and reset each rep.',
    ),
    muscles: [
      ['gluteus_maximus', 25],
      ['hamstrings', 25],
      ['erector_spinae', 25],
      ['latissimus_dorsi', 10],
      ['trapezius_upper', 10],
      ['forearm_flexors', 5],
    ],
  },
  {
    name: 'Romanian Deadlift',
    video: 'https://www.youtube.com/watch?v=_oyxCn2iSjU',
    equipment: ['barbell'],
    description:
      'Hinge from the top with soft knees. Loads the hamstrings and glutes hardest in the stretch.',
    instructions: steps(
      'Start standing with the bar. Slight knee bend, bar over mid-foot.',
      'Push the hips back and slide the bar down the thighs.',
      'Stop where the hamstrings run out of length with the lower back still neutral.',
      'Drive the hips forward to stand. Straps are fine: grip is not the target.',
    ),
    muscles: [
      ['hamstrings', 45],
      ['gluteus_maximus', 30],
      ['erector_spinae', 20],
      ['forearm_flexors', 5],
    ],
  },
  {
    name: 'Dumbbell Romanian Deadlift',
    video: 'https://www.youtube.com/watch?v=gW-7wKSAhEY',
    equipment: ['dumbbells'],
    description:
      'A Romanian deadlift with a dumbbell in each hand: the hamstring stretch without a barbell.',
    instructions: steps(
      'Dumbbells in front of the thighs, slight knee bend.',
      'Push the hips back, dumbbells close to the legs, until the hamstrings run out of length.',
      'Keep the lower back neutral and drive the hips forward to stand.',
    ),
    muscles: [
      ['hamstrings', 45],
      ['gluteus_maximus', 30],
      ['erector_spinae', 20],
      ['forearm_flexors', 5],
    ],
  },
  {
    name: 'Stiff-Leg Deadlift',
    video: 'https://www.youtube.com/watch?v=hURqtvoZi3c',
    equipment: ['barbell'],
    description:
      'Hinge with the knees nearly straight, each rep from the floor or a dead stop. More hamstring stretch than a Romanian deadlift; heavy, so not a lift to take to failure.',
    instructions: steps(
      'Feet hip width, bar over mid-foot, only a slight bend in the knees.',
      'Hinge down with a flat back as far as the hamstrings allow — to the floor, or just short of it.',
      'Stand by driving the hips forward, bar close to the legs. Straps are fine.',
    ),
    muscles: [
      ['hamstrings', 50],
      ['gluteus_maximus', 25],
      ['erector_spinae', 20],
      ['forearm_flexors', 5],
    ],
  },
  {
    name: 'Good Morning',
    video: 'https://www.youtube.com/watch?v=Yape6k1xU1I',
    equipment: ['barbell', 'rack'],
    description:
      'Hinge with the bar on the back. Hamstrings and spinal erectors in the stretch; a strength accessory for the squat and deadlift.',
    instructions: steps(
      'Bar on the upper back as for a squat, knees slightly bent.',
      'Push the hips back with the back neutral until the hamstrings stop you; a short range is fine.',
      'Drive the hips forward to stand.',
    ),
    muscles: [
      ['hamstrings', 40],
      ['gluteus_maximus', 30],
      ['erector_spinae', 30],
    ],
  },
  {
    name: 'Hip Thrust',
    video: 'https://www.youtube.com/watch?v=S_uZP4UH6J0',
    equipment: ['barbell', 'flat_bench'],
    description:
      'Shoulders on a bench, drive the hips to lockout. Loads the glutes hardest at the top, so it complements squats and hinges.',
    instructions: steps(
      'Upper back on the bench edge, padded bar over the hips, feet hip width.',
      'Set the feet so the shins are vertical at the top, and remember the spot.',
      'Chin tucked, drive the hips up to lockout and squeeze.',
      'Lower to a full stop each rep — no bouncing.',
    ),
    muscles: [
      ['gluteus_maximus', 65],
      ['hamstrings', 25],
      ['quadriceps', 10],
    ],
  },
  {
    name: 'Back Extension',
    video: 'https://www.youtube.com/watch?v=xyV2rF8ismg',
    equipment: ['back_extension_bench'],
    tracking: 'bodyweight_reps',
    description:
      'Hinge on a 45-degree or horizontal bench. Glutes, hamstrings and erectors; add a plate to progress.',
    instructions: steps(
      'Pad at the top of the thighs so the hips can hinge freely.',
      'Lower to about 90 degrees at the hip, back neutral.',
      'Rise until the body is straight; do not hyperextend.',
      'A rounded-back version shifts the work to the erectors — only once experienced, and keep the rounding constant.',
    ),
    muscles: [
      ['erector_spinae', 45],
      ['gluteus_maximus', 30],
      ['hamstrings', 25],
    ],
  },
  {
    name: 'Seated Leg Curl',
    video: 'https://www.youtube.com/watch?v=ELOCsoDSmrg',
    equipment: ['seated_leg_curl'],
    description:
      'Knee flexion with the hip bent, which stretches the hamstrings further than a lying curl. The first-choice hamstring isolation.',
    instructions: steps(
      'Pad just above the heels, thigh pad tight on the quads with no gap.',
      'Set the machine for the biggest stretch; leaning the torso forward stretches the hamstrings more.',
      'Curl fully and return under control to the stretch.',
    ),
    muscles: [
      ['hamstrings', 95],
      ['gastrocnemius', 5],
    ],
  },
  {
    name: 'Lying Leg Curl',
    video: 'https://www.youtube.com/watch?v=5Uvvd6NsCyU',
    equipment: ['lying_leg_curl'],
    description:
      'Isolated knee flexion lying face down. A seated curl stretches the hamstrings more; use this when that is unavailable.',
    instructions: steps(
      'Pad just above the heels, knees just off the end of the bench.',
      'Keep the hips pressed into the pad as you curl.',
      'Lower all the way to the stretch under control.',
    ),
    muscles: [
      ['hamstrings', 90],
      ['gastrocnemius', 10],
    ],
  },
  {
    name: 'Nordic Ham Curl',
    video: 'https://www.youtube.com/watch?v=TyKAicsT7Dg',
    equipment: [],
    tracking: 'bodyweight_reps',
    description:
      'Bodyweight eccentric knee flexion with the ankles anchored. Very hard at full knee extension, where the hamstrings are long.',
    instructions: steps(
      'Kneel on a pad with the ankles held under something fixed.',
      'Lower the body forward, moving only at the knees, hips locked, as far as you can control.',
      'Catch yourself in a push-up position and push off as little as possible to come back up.',
      'Use a band for assistance or a partial range, and add depth each week.',
    ),
    muscles: [
      ['hamstrings', 85],
      ['gastrocnemius', 10],
      ['gluteus_maximus', 5],
    ],
  },
  {
    name: 'Kettlebell Swing',
    video: 'https://www.youtube.com/watch?v=OoIzSrXeqjY',
    equipment: ['kettlebells'],
    description:
      'Ballistic hinge for power and conditioning. Power from the hips, not a front raise.',
    instructions: steps(
      'Bell a foot in front, hinge and grip it, back neutral.',
      'Hike it back between the legs, then snap the hips forward to float it to chest height.',
      'Let it fall back into the hinge; the arms only guide it.',
    ),
    muscles: [
      ['gluteus_maximus', 40],
      ['hamstrings', 30],
      ['erector_spinae', 20],
      ['forearm_flexors', 10],
    ],
  },

  // ---- horizontal push ----
  {
    name: 'Barbell Bench Press',
    video: 'https://www.youtube.com/watch?v=GcT-1zLjaKk',
    equipment: ['barbell', 'rack', 'flat_bench'],
    description:
      'Flat bench press. The main horizontal press for chest, front delts and triceps, and the strength benchmark for the upper body.',
    instructions: steps(
      'Eyes under the bar, shoulder blades back and down, a small upper-back arch.',
      'Grip 1.25–1.5× shoulder width, wrists straight.',
      'Lower with the elbows about 45° from the body to touch the lower chest. No bounce.',
      'Press up and slightly back toward the rack.',
    ),
    muscles: [
      ['pectoralis_major', 55],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Smith Machine Bench Press',
    video: 'https://www.youtube.com/watch?v=AfcBc_nSHIc',
    equipment: ['smith_machine', 'flat_bench'],
    description: 'Bench press on a fixed path: easier to push close to failure without a spotter.',
    instructions: steps(
      'Set the bench so the bar touches the lower chest.',
      'Shoulder blades back and down, elbows about 45° from the body.',
      'Pause a moment on the chest to keep the pecs loaded, then press.',
    ),
    muscles: [
      ['pectoralis_major', 55],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Flat Dumbbell Press',
    video: 'https://www.youtube.com/watch?v=Y_7aHqXeCfQ',
    equipment: ['dumbbells', 'flat_bench'],
    description:
      'Bench press with dumbbells. A deeper stretch on the chest than a barbell, and each side works on its own.',
    instructions: steps(
      'Kick the dumbbells up from the knees as you lie back.',
      'Forearms vertical; lower to about lower-chest level, elbows flared as is comfortable.',
      'Shorten the range if the shoulders complain. Press up and slightly in.',
    ),
    muscles: [
      ['pectoralis_major', 60],
      ['triceps_brachii', 20],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Machine Chest Press',
    video: 'https://www.youtube.com/watch?v=xUm0BiZCWlQ',
    equipment: ['chest_press'],
    description:
      'Horizontal press with the path fixed and the trunk supported. Safe to push to failure, so a staple of high-effort programs.',
    instructions: steps(
      'Set the seat so the handles line up with the mid-chest.',
      'Shoulder blades back against the pad.',
      'Pause a moment in the stretch with the pecs loaded, then press without locking out hard.',
    ),
    muscles: [
      ['pectoralis_major', 55],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Incline Dumbbell Press',
    video: 'https://www.youtube.com/watch?v=wY4iYfQptu8',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Around 30 degrees. More upper chest and front delt than flat pressing; most programs include an incline press.',
    instructions: steps(
      'Bench at 15–45°: steeper means more front delt and upper chest.',
      'Kick the dumbbells up from the knees, forearms vertical.',
      'Lower to the upper chest, then press up and slightly in.',
    ),
    muscles: [
      ['pectoralis_major', 45],
      ['deltoid_anterior', 30],
      ['triceps_brachii', 25],
    ],
  },
  {
    name: 'Incline Barbell Bench Press',
    video: 'https://www.youtube.com/watch?v=vbc9E9_Clb4',
    equipment: ['barbell', 'rack', 'incline_bench'],
    description:
      'Bench press on an incline. Upper chest and front delts, with a higher touch point and a more vertical path.',
    instructions: steps(
      'Bench at 15–45°, shoulder blades back and down.',
      'Lower to the upper chest, higher than on a flat bench.',
      'Press in a more vertical line than a flat bench press.',
    ),
    muscles: [
      ['pectoralis_major', 45],
      ['deltoid_anterior', 30],
      ['triceps_brachii', 25],
    ],
  },
  {
    name: 'Close-Grip Bench Press',
    video: 'https://www.youtube.com/watch?v=nEF0bv2FW94',
    equipment: ['barbell', 'rack', 'flat_bench'],
    description:
      'Bench press with a narrower grip. More triceps and upper chest; a strength accessory that carries over to the bench.',
    instructions: steps(
      'Grip 1–1.25× shoulder width — no narrower.',
      'Tuck the elbows and touch slightly lower on the chest.',
      'Expect about 15–25% less weight than a normal bench: the range is longer.',
    ),
    muscles: [
      ['triceps_brachii', 45],
      ['pectoralis_major', 35],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Push-Up',
    video: 'https://www.youtube.com/watch?v=7oRwqK6sfdk',
    equipment: [],
    tracking: 'bodyweight_reps',
    description:
      'Rigid trunk, full range. A deficit (hands on blocks) adds stretch; a band across the back adds load at the top. Log added weight in the weight field.',
    instructions: steps(
      'Hands just outside the shoulders; screw the palms into the floor.',
      'Body straight from head to heels; lower the chest to the floor.',
      'On a deficit, pause 2–3 s at the bottom and back off if the shoulders complain.',
    ),
    muscles: [
      ['pectoralis_major', 50],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 15],
      ['serratus_anterior', 10],
    ],
  },
  {
    name: 'Dip',
    video: 'https://www.youtube.com/watch?v=U7HeutDqS_w',
    equipment: ['parallel_bars'],
    tracking: 'bodyweight_reps',
    description:
      'Lean forward for lower chest, stay upright for triceps. Deep stretch on the chest. Log added weight.',
    instructions: steps(
      'Grip just outside the shoulders, shoulders packed down.',
      'Lean slightly forward and lower to about 90° at the elbow or a clear stretch.',
      'A painful stretch means too deep: stop short of it. Press back to lockout.',
    ),
    muscles: [
      ['pectoralis_major', 40],
      ['triceps_brachii', 40],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Cable Fly',
    video: 'https://www.youtube.com/watch?v=7Sb0HtOfCaI',
    equipment: ['cable_crossover'],
    description:
      'Isolated chest adduction with tension through the full range. Pulley height picks the region: low for upper chest, high for lower.',
    instructions: steps(
      'Pulleys at chest height for mid chest, low for upper chest, overhead for lower chest.',
      'Step forward, slight fixed bend in the elbows.',
      'Open wide into a deep stretch, then bring the hands together in an arc.',
    ),
    muscles: [
      ['pectoralis_major', 85],
      ['deltoid_anterior', 15],
    ],
  },
  {
    name: 'Single-Arm Cable Fly',
    video: 'https://www.youtube.com/watch?v=FJfDGl1Z_mk',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'A cable fly from one low pulley, low to high, which biases the upper chest: the fly for a single cable stack, where a crossover needs two. Weight shown is per side.',
    instructions: steps(
      'Pulley low. Stand side-on to it, handle in the far hand, arm long and slightly behind you.',
      'Elbow slightly bent and fixed, sweep the hand up and across to chin height in front of the chest.',
      'Return slowly into the stretch, letting the chest open fully.',
    ),
    muscles: [
      ['pectoralis_major', 85],
      ['deltoid_anterior', 15],
    ],
  },
  {
    name: 'Pec Deck',
    video: 'https://www.youtube.com/watch?v=-DZXcuPi4vk',
    equipment: ['pec_deck'],
    description:
      'Machine fly. Chest isolation that stays loaded in the stretch and is safe to take to failure.',
    instructions: steps(
      'Seat so the handles sit at mid-chest, elbows slightly bent and fixed.',
      'Open into a deep stretch and pause a moment there.',
      'Bring the handles together without letting the shoulders roll forward.',
    ),
    muscles: [
      ['pectoralis_major', 85],
      ['deltoid_anterior', 15],
    ],
  },
  {
    name: 'Dumbbell Fly',
    video: 'https://www.youtube.com/watch?v=QENKPHhQVi4',
    equipment: ['dumbbells', 'flat_bench'],
    description:
      'Fly with dumbbells: heavy in the stretch, nearly nothing at the top. Work the bottom half.',
    instructions: steps(
      'Lie on a flat bench, dumbbells above the chest, elbows slightly bent and fixed.',
      'Lower in a wide arc into a deep stretch.',
      'Stop well short of the top, where the dumbbells stop loading the chest. Stretched-half reps are a fine advanced option.',
    ),
    muscles: [
      ['pectoralis_major', 85],
      ['deltoid_anterior', 15],
    ],
  },

  // ---- vertical push ----
  {
    name: 'Overhead Press',
    video: 'https://www.youtube.com/watch?v=5QSuBRkZPoo',
    equipment: ['barbell', 'rack'],
    description:
      'Strict barbell press from the shoulders, standing or seated. Front delts and triceps, and an upper-body strength benchmark.',
    instructions: steps(
      'Grip slightly outside the shoulders, forearms vertical.',
      'Squeeze the glutes so the lower back does not arch.',
      'Move the head back to let the bar pass, then through once it is past.',
      'Finish with bar, shoulders, hips and mid-foot in line. No knee drive; stop dead each rep.',
    ),
    muscles: [
      ['deltoid_anterior', 40],
      ['triceps_brachii', 25],
      ['deltoid_lateral', 20],
      ['rectus_abdominis', 10],
      ['trapezius_upper', 5],
    ],
  },
  {
    name: 'Seated Dumbbell Shoulder Press',
    video: 'https://www.youtube.com/watch?v=8kwDkC8JhdY',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Shoulder press with dumbbells on an upright bench. Front and side delts; standing works too and adds trunk.',
    instructions: steps(
      'Bench upright. Kick the dumbbells up from the thighs to the shoulders.',
      'Elbows at whatever angle is comfortable; lower until the elbows pass 90°.',
      'Press up and slightly in.',
    ),
    muscles: [
      ['deltoid_anterior', 45],
      ['triceps_brachii', 30],
      ['deltoid_lateral', 25],
    ],
  },
  {
    name: 'Standing Dumbbell Shoulder Press',
    video: 'https://www.youtube.com/watch?v=e_f5oodNEcI',
    equipment: ['dumbbells'],
    description:
      'Shoulder press with dumbbells, standing: the same delts as seated, more trunk, and no bench needed.',
    instructions: steps(
      'Clean the dumbbells to the shoulders, feet hip width, glutes and abs tight.',
      'Press up and slightly in without leaning back or driving with the knees.',
      'Lower until the elbows pass 90°.',
    ),
    muscles: [
      ['deltoid_anterior', 45],
      ['triceps_brachii', 25],
      ['deltoid_lateral', 20],
      ['rectus_abdominis', 10],
    ],
  },
  {
    name: 'Machine Shoulder Press',
    video: 'https://www.youtube.com/watch?v=Anu8s_nkNpM',
    equipment: ['shoulder_press'],
    description:
      'Vertical press on a fixed path. Front and side delts, safe to take close to failure.',
    instructions: steps(
      'Seat so the handles start at about shoulder height.',
      'Lower until the elbows pass 90°, keeping the delts loaded.',
      'Press smoothly without locking out hard.',
    ),
    muscles: [
      ['deltoid_anterior', 50],
      ['triceps_brachii', 30],
      ['deltoid_lateral', 20],
    ],
  },
  {
    name: 'Dumbbell Lateral Raise',
    video: 'https://www.youtube.com/watch?v=U3Atcn3wFjY',
    equipment: ['dumbbells'],
    description:
      'The basic side-delt isolation; side delts need at least one. Light weight, no swing. Easiest at the bottom.',
    instructions: steps(
      'Dumbbells at the sides, slight bend in the elbows.',
      'Raise up and slightly forward — not straight out — to shoulder height.',
      'A small pinkie-up tilt is optional. Lower under control; do not swing the next rep.',
    ),
    muscles: [
      ['deltoid_lateral', 80],
      ['deltoid_anterior', 10],
      ['trapezius_upper', 10],
    ],
  },
  {
    name: 'Cable Lateral Raise',
    video: 'https://www.youtube.com/watch?v=nMCQuV6HE3A',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'Lateral raise against a cable, which keeps the side delt loaded at the bottom where dumbbells go slack. Weight shown is per side.',
    instructions: steps(
      'Stand side-on to a low pulley — or one at wrist height, if it adjusts — handle in the far hand, cable crossing in front of the body.',
      'Start with the hand across the midline for a stretch.',
      'Raise up and slightly forward to shoulder height, then lower under control.',
    ),
    muscles: [
      ['deltoid_lateral', 85],
      ['trapezius_upper', 10],
      ['deltoid_anterior', 5],
    ],
  },
  {
    name: 'Incline Dumbbell Y-Raise',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Raise up and out in a Y with the back on a 30-degree incline. Side delts, with the lower traps helping; light weight.',
    instructions: steps(
      'Bench at about 30°, back on the pad, dumbbells hanging at the sides.',
      'Raise the arms up and out in a Y, thumbs up, to about head height.',
      'Lower under control without swinging.',
    ),
    muscles: [
      ['deltoid_lateral', 65],
      ['trapezius_lower', 20],
      ['deltoid_anterior', 15],
    ],
  },
  {
    name: 'Cable Upright Row',
    video: 'https://www.youtube.com/watch?v=XoI1t4DqBRY',
    equipment: ['low_pulley'],
    description: 'Side delts and upper traps together. Lead with the elbows.',
    instructions: steps(
      'Straight bar or rope on a low pulley, grip 1–1.5× shoulder width.',
      'Pull with the elbows leading, up to shoulder height and no higher.',
      'Lower under control.',
    ),
    muscles: [
      ['deltoid_lateral', 50],
      ['trapezius_upper', 35],
      ['deltoid_anterior', 10],
      ['biceps_brachii', 5],
    ],
  },

  // ---- vertical pull ----
  {
    name: 'Pull-Up',
    video: 'https://www.youtube.com/watch?v=B3DM8jhWFzA',
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description:
      "Pronated grip. Lats, mid and lower traps, biceps. Log added weight in the weight field, or a band's help as assistance.",
    instructions: steps(
      'Overhand grip about 1.5× shoulder width.',
      'Start each rep from a full dead hang to stretch the lats.',
      'Arch slightly and drive the elbows down until the chin clears the hands, ideally upper chest to the bar.',
    ),
    muscles: [
      ['latissimus_dorsi', 50],
      ['biceps_brachii', 20],
      ['brachialis', 10],
      ['teres_major', 10],
      ['trapezius_lower', 10],
    ],
  },
  {
    name: 'Assisted Pull-Up',
    video: 'https://www.youtube.com/watch?v=4wDx0ZCCgk0',
    equipment: ['assisted_pull_up'],
    tracking: 'bodyweight_reps',
    description:
      "Pull-up on a counterweight machine. Log the machine's help as assistance: less help is progress.",
    instructions: steps(
      'Set the counterweight, kneel or stand on the platform, overhand grip about 1.5× shoulder width.',
      'Start from a full stretch at the bottom.',
      'Drive the elbows down until the chin clears the hands. Reduce the help as you get stronger.',
    ),
    muscles: [
      ['latissimus_dorsi', 50],
      ['biceps_brachii', 20],
      ['brachialis', 10],
      ['teres_major', 10],
      ['trapezius_lower', 10],
    ],
  },
  {
    name: 'Chin-Up',
    video: 'https://www.youtube.com/watch?v=dYDJpuDiJGc',
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description:
      'Supinated grip. More biceps than a pull-up. Log added weight in the weight field.',
    instructions: steps(
      'Underhand grip about shoulder width.',
      'Start each rep from a full dead hang.',
      'Drive the elbows down toward the hips until the upper chest reaches the bar, or at least the chin clears the hands.',
    ),
    muscles: [
      ['latissimus_dorsi', 40],
      ['biceps_brachii', 30],
      ['brachialis', 15],
      ['teres_major', 15],
    ],
  },
  {
    name: 'Lat Pulldown',
    video: 'https://www.youtube.com/watch?v=GL3h256d6JM',
    equipment: ['high_pulley'],
    description:
      'Scalable vertical pull. Grip changes the bias: underhand for more biceps, a narrow neutral handle for more lats. Hardest at the bottom, the short end, so lengthened partials suit its last set.',
    instructions: steps(
      'Thighs locked under the pad. Overhand grip 1–1.5× shoulder width by default.',
      'Let the arms reach fully overhead to stretch the lats before each rep.',
      'Drive the elbows down, not the hands. A slight lean back is fine, but not for momentum.',
    ),
    muscles: [
      ['latissimus_dorsi', 55],
      ['biceps_brachii', 20],
      ['teres_major', 15],
      ['trapezius_lower', 10],
    ],
  },
  {
    name: 'Cable Lat Pullover',
    video: 'https://www.youtube.com/watch?v=n3O1jkQyXC4',
    equipment: ['high_pulley'],
    description:
      'Straight-arm pulldown. Isolates the lats without the biceps, with tension through the full range.',
    instructions: steps(
      'Bar, EZ bar or rope on a high pulley. Hinge forward 30–45°, arms straight overhead.',
      'Let the arms rise into a deep lat stretch.',
      'Sweep the bar down in an arc to the thighs, arms straight; the rope allows a little more range.',
    ),
    muscles: [
      ['latissimus_dorsi', 70],
      ['teres_major', 20],
      ['triceps_brachii', 10],
    ],
  },
  {
    name: 'Dumbbell Pullover',
    video: 'https://www.youtube.com/watch?v=uQigJHNgYt0',
    equipment: ['dumbbells', 'flat_bench'],
    description:
      'Lying pullover with one dumbbell. Lats and chest, loaded only in the stretched bottom half.',
    instructions: steps(
      'Lie across or along a bench, one dumbbell held over the chest in both hands.',
      'Lower it behind the head in an arc with slightly bent elbows into a deep stretch.',
      'Pull back only to about head level: past that the dumbbell stops loading the lats.',
    ),
    muscles: [
      ['latissimus_dorsi', 45],
      ['pectoralis_major', 30],
      ['teres_major', 15],
      ['triceps_brachii', 10],
    ],
  },
  {
    name: 'Cable Lat Pull-In',
    video: 'https://www.youtube.com/watch?v=vtUsS1ZispY',
    equipment: ['adjustable_pulley'],
    isUnilateral: true,
    description:
      'One-arm pull in an arc from overhead to the hip. A light lat isolation and activation drill. Weight shown is per side.',
    instructions: steps(
      'Pulley high, handle in one hand; half-kneel or stand side-on.',
      'Let the arm reach up and out into a stretch.',
      'Pull the elbow in and down to the hip in an arc, then return slowly. Light, 15–20 reps a side.',
    ),
    muscles: [
      ['latissimus_dorsi', 75],
      ['teres_major', 20],
      ['deltoid_posterior', 5],
    ],
  },

  // ---- horizontal pull ----
  {
    name: 'Barbell Row',
    video: 'https://www.youtube.com/watch?v=Nr6Gu67wf40',
    equipment: ['barbell'],
    description:
      'Hinged torso, pull to the upper abs. Mid back and lats. Pulling each rep from the floor makes it a Pendlay row.',
    instructions: steps(
      'Overhand grip 1.25–1.5× shoulder width, torso about 45°.',
      'Row to the upper abs, elbows about 45° from the body.',
      'If the hips start driving the bar, cut the load. Chalk or straps for the heaviest sets.',
      'Pendlay variation: torso near parallel, bar from a dead stop on the floor each rep.',
    ),
    muscles: [
      ['latissimus_dorsi', 35],
      ['rhomboids', 20],
      ['trapezius_middle', 20],
      ['biceps_brachii', 15],
      ['erector_spinae', 10],
    ],
  },
  {
    name: 'Seated Cable Row',
    video: 'https://www.youtube.com/watch?v=xjlz8lRXOOI',
    equipment: ['low_pulley'],
    description:
      'Chest tall, pull to the abdomen without rocking. Elbows tucked for lats, flared for upper back. Hardest at the short end, so lengthened partials suit its last set.',
    instructions: steps(
      'Feet braced, knees soft, chest tall.',
      'Let the arms reach forward to stretch the back without rounding much.',
      'Pull to the abdomen, elbows tucked for lats or flared for upper back. No rocking.',
    ),
    muscles: [
      ['latissimus_dorsi', 35],
      ['rhomboids', 25],
      ['trapezius_middle', 20],
      ['biceps_brachii', 20],
    ],
  },
  {
    name: 'Single-Arm Dumbbell Row',
    video: 'https://www.youtube.com/watch?v=Llp307FAKz0',
    equipment: ['dumbbells', 'flat_bench'],
    isUnilateral: true,
    description:
      'One arm supported. Lets the lat stretch further than a barbell row. Weight shown is per side.',
    instructions: steps(
      'One hand and knee on a bench, back flat.',
      'Let the dumbbell drift forward at the bottom to stretch the lat.',
      'Row in a lawnmower arc toward the hip, elbow ending about 90°.',
    ),
    muscles: [
      ['latissimus_dorsi', 45],
      ['rhomboids', 20],
      ['biceps_brachii', 20],
      ['trapezius_middle', 15],
    ],
  },
  {
    name: 'Chest-Supported Dumbbell Row',
    video: 'https://www.youtube.com/watch?v=Nx0TzjgsI-0',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Row lying chest-down on an incline bench. No lower-back fatigue, so the upper back can be taken to failure. Hardest at the short end, so lengthened partials suit its last set.',
    instructions: steps(
      'Incline bench at about 30–45°, chest on the pad, dumbbells hanging.',
      'Row with the elbows about 45° from the body.',
      'Squeeze the shoulder blades at the top, then lower to a full stretch.',
    ),
    muscles: [
      ['latissimus_dorsi', 35],
      ['rhomboids', 20],
      ['trapezius_middle', 20],
      ['biceps_brachii', 15],
      ['deltoid_posterior', 10],
    ],
  },
  {
    name: 'Face Pull',
    video: 'https://www.youtube.com/watch?v=SdyH7cnJnkg',
    equipment: ['high_pulley'],
    description:
      'Rope pull to the face with high elbows. Rear delts, mid traps and rotator cuff together; a reverse fly isolates the rear delts better.',
    instructions: steps(
      'Rope on a high pulley, at or a little above head height.',
      'Pull the rope toward the forehead, elbows high and back, hands apart.',
      'Return under control to a stretch.',
    ),
    muscles: [
      ['deltoid_posterior', 40],
      ['rhomboids', 25],
      ['trapezius_middle', 25],
      ['rotator_cuff', 10],
    ],
  },
  {
    name: 'Reverse Pec Deck',
    video: 'https://www.youtube.com/watch?v=Y7ZKBP5bMwg',
    equipment: ['pec_deck'],
    description:
      'Rear-delt fly on the pec deck. The cleanest rear-delt isolation, which grows best with direct work.',
    instructions: steps(
      'Face the pad, handles at shoulder height, arms nearly straight.',
      'Sweep the arms back in a wide arc.',
      'Stop before the shoulder blades squeeze together, so the rear delts do the work. Return to a stretch.',
    ),
    muscles: [
      ['deltoid_posterior', 70],
      ['trapezius_middle', 15],
      ['rhomboids', 15],
    ],
  },
  {
    name: 'Reverse Cable Fly',
    video: 'https://www.youtube.com/watch?v=IaPphp40p64',
    equipment: ['cable_crossover'],
    description: 'Rear-delt fly between two cables, crossed in front for a long stretch.',
    instructions: steps(
      'Pulleys at shoulder height. Take the left cable in the right hand and the right in the left, so the cables cross.',
      'Arms nearly straight, sweep them back and out in a wide arc.',
      'Stop before the shoulder blades squeeze together. Return to the crossed stretch.',
    ),
    muscles: [
      ['deltoid_posterior', 70],
      ['trapezius_middle', 15],
      ['rhomboids', 15],
    ],
  },
  {
    name: 'Single-Arm Reverse Cable Fly',
    video: 'https://www.youtube.com/watch?v=GDEINoYs10U',
    equipment: ['high_pulley'],
    isUnilateral: true,
    description:
      'Rear-delt fly from one high pulley, the cable crossed in front of the body for a long stretch: the reverse fly for a single cable stack. Weight shown is per side.',
    instructions: steps(
      'Pulley high, no handle or a single one. Stand facing it and take the cable in the opposite hand, so it crosses in front of you.',
      'Arm nearly straight, sweep it out and back, a little downwards, until it is in line with the shoulder.',
      'Keep the torso square, no twisting. Return to the crossed stretch.',
    ),
    muscles: [
      ['deltoid_posterior', 70],
      ['trapezius_middle', 15],
      ['rhomboids', 15],
    ],
  },
  {
    name: 'Reverse Dumbbell Fly',
    video: 'https://www.youtube.com/watch?v=unjx98CZqbQ',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Rear-delt fly lying chest-down on an incline bench: rear delts with nothing but dumbbells.',
    instructions: steps(
      'Chest on an incline bench, dumbbells hanging, elbows slightly bent.',
      'Raise the arms out to the sides in a wide arc.',
      'Skip the final shoulder-blade squeeze, and lower under control.',
    ),
    muscles: [
      ['deltoid_posterior', 65],
      ['trapezius_middle', 20],
      ['rhomboids', 15],
    ],
  },
  {
    name: 'Barbell Shrug',
    video: 'https://www.youtube.com/watch?v=r2wisVX3ayc',
    equipment: ['barbell'],
    description:
      'Upper traps, which need direct work for full development. Pause at the top and stretch at the bottom.',
    instructions: steps(
      'Grip 1.25–1.5× shoulder width; straps when grip gives out first.',
      'Shrug straight up and pause at the top.',
      'Lower into a 1–2 s stretch at the bottom.',
    ),
    muscles: [
      ['trapezius_upper', 85],
      ['forearm_flexors', 10],
      ['trapezius_middle', 5],
    ],
  },
  {
    name: 'Dumbbell Shrug',
    video: 'https://www.youtube.com/watch?v=BVoAUscFYFo',
    equipment: ['dumbbells'],
    description: 'Upper-trap shrug with dumbbells at the sides: a freer path than a barbell.',
    instructions: steps(
      'Dumbbells at the sides; straps when grip gives out first.',
      'Shrug straight up and pause at the top.',
      'Lower into a 1–2 s stretch at the bottom.',
    ),
    muscles: [
      ['trapezius_upper', 85],
      ['forearm_flexors', 10],
      ['trapezius_middle', 5],
    ],
  },
  {
    name: 'Trap Bar Shrug',
    video: 'https://www.youtube.com/watch?v=IJiEOqZgTz0',
    equipment: ['trap_bar'],
    description: 'Upper-trap shrug with the load at the sides and a heavy bar.',
    instructions: steps(
      'Stand inside the bar, neutral grip; straps when grip gives out first.',
      'Shrug straight up and pause at the top.',
      'Lower into a 1–2 s stretch at the bottom.',
    ),
    muscles: [
      ['trapezius_upper', 85],
      ['forearm_flexors', 10],
      ['trapezius_middle', 5],
    ],
  },

  // ---- arms ----
  {
    name: 'Barbell Curl',
    video: 'https://www.youtube.com/watch?v=QZEqB6wUPxQ',
    equipment: ['barbell'],
    description: 'Standing curl with a straight bar. The heaviest-loading biceps curl.',
    instructions: steps(
      'Loose grip about shoulder width.',
      'Curl in an arc, letting the elbows drift slightly forward; press through the ring and pinky fingers.',
      'Lower to full extension under control.',
    ),
    muscles: [
      ['biceps_brachii', 70],
      ['brachialis', 20],
      ['brachioradialis', 10],
    ],
  },
  {
    name: 'EZ-Bar Curl',
    video: 'https://www.youtube.com/watch?v=mANRmIqemHY',
    equipment: ['ez_bar'],
    description: 'Standing curl on the angled bar, easier on the wrists than a straight bar.',
    instructions: steps(
      'Loose grip on the angled handles.',
      'Curl in an arc, elbows drifting slightly forward.',
      'Lower to full extension under control.',
    ),
    muscles: [
      ['biceps_brachii', 70],
      ['brachialis', 20],
      ['brachioradialis', 10],
    ],
  },
  {
    name: 'Dumbbell Curl',
    video: 'https://www.youtube.com/watch?v=d_TfENBv38s',
    equipment: ['dumbbells'],
    description: 'Standing curl with dumbbells, palms turning up as they rise.',
    instructions: steps(
      'Dumbbells at the sides, loose grip.',
      'Curl, rotating the palms up, elbows drifting slightly forward.',
      'Lower to full extension. Alternating arms is fine.',
    ),
    muscles: [
      ['biceps_brachii', 75],
      ['brachialis', 15],
      ['brachioradialis', 10],
    ],
  },
  {
    name: 'Incline Dumbbell Curl',
    video: 'https://www.youtube.com/watch?v=5uAAU3sUURA',
    equipment: ['dumbbells', 'incline_bench'],
    description:
      'Curl with the arms hanging behind the body, which stretches the biceps at the shoulder. Hardest in the stretch.',
    instructions: steps(
      'Bench at about 45–60°, back on the pad, arms hanging straight down.',
      'Curl without bringing the elbows forward.',
      'Lower all the way to the stretch.',
    ),
    muscles: [
      ['biceps_brachii', 80],
      ['brachialis', 15],
      ['brachioradialis', 5],
    ],
  },
  {
    name: 'Bayesian Cable Curl',
    video: 'https://www.youtube.com/watch?v=1buGhj5AWbo',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'One-arm curl facing away from a low pulley, the arm pulled behind the body. Loads the biceps in the stretch. Weight shown is per side.',
    instructions: steps(
      'Handle in one hand, face away from the pulley, step forward so the arm is drawn behind the body.',
      'Curl without letting the elbow drift forward much.',
      'Return slowly to the stretch. Start with the weaker arm.',
    ),
    muscles: [
      ['biceps_brachii', 80],
      ['brachialis', 15],
      ['brachioradialis', 5],
    ],
  },
  {
    name: 'Dumbbell Preacher Curl',
    video: 'https://www.youtube.com/watch?v=-2uA7XYHGcc',
    equipment: ['dumbbells', 'incline_bench'],
    isUnilateral: true,
    description:
      'One-arm curl with the upper arm on a pad: a preacher bench, or the back of an incline bench. Hardest at the bottom, where the brachialis is long. Weight shown is per side.',
    instructions: steps(
      'Back of the arm flat on the pad, armpit tight to its top edge.',
      'Lower to almost straight under control — that is where it is hardest.',
      'Curl up without lifting the elbow off the pad.',
    ),
    muscles: [
      ['biceps_brachii', 55],
      ['brachialis', 35],
      ['brachioradialis', 10],
    ],
  },
  {
    name: 'Hammer Curl',
    video: 'https://www.youtube.com/watch?v=LRr6xK2uRXs',
    equipment: ['dumbbells'],
    description: 'Neutral grip. Biases brachialis and brachioradialis over biceps.',
    instructions: steps(
      'Dumbbells at the sides, palms facing each other, firm grip.',
      'Curl without rotating the wrists, elbows close to the body.',
      'Lower to full extension.',
    ),
    muscles: [
      ['brachioradialis', 40],
      ['biceps_brachii', 35],
      ['brachialis', 25],
    ],
  },
  {
    name: 'Triceps Pushdown',
    video: 'https://www.youtube.com/watch?v=Rpv1iD4u7Us',
    equipment: ['high_pulley'],
    description:
      'Elbows pinned, extend to lockout. Triceps with the arms at the sides; also called the pressdown.',
    instructions: steps(
      'Bar or rope on a high pulley, start with the hands at about chin height.',
      'Elbows fixed at the sides; move only at the elbow.',
      'Press to full lockout and return under control.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Overhead Cable Triceps Extension',
    video: 'https://www.youtube.com/watch?v=jioCqlKKrJc',
    equipment: ['adjustable_pulley'],
    description:
      'Triceps extension with the arms overhead, which stretches the long head. Intermediates need an overhead variation.',
    instructions: steps(
      'Rope on a pulley at about head height. Face away, staggered stance, arms overhead.',
      'Let the hands travel behind the head into a deep stretch, elbows pointing forward.',
      'Extend to lockout without the elbows flaring.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Dumbbell Overhead Triceps Extension',
    video: 'https://www.youtube.com/watch?v=fMOd6RmMlWk',
    equipment: ['dumbbells'],
    description:
      'Overhead triceps extension with one dumbbell. The long-head stretch with no cable.',
    instructions: steps(
      'Hold one dumbbell overhead in both hands by the inner plate, seated or standing.',
      'Lower it behind the head, elbows pointing up and forward.',
      'Extend to lockout.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Skull Crusher',
    video: 'https://www.youtube.com/watch?v=IB4Wuf7Aqzw',
    equipment: ['ez_bar', 'flat_bench'],
    description: 'Lying triceps extension with an EZ bar. Loads the long head at length.',
    instructions: steps(
      'Lie on a bench, bar over the shoulders, arms angled slightly back toward the ears.',
      'Lower the bar behind the head, not to the forehead.',
      'Extend to lockout, moving only at the elbows.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Dumbbell Skull Crusher',
    video: 'https://www.youtube.com/watch?v=UQuJu-gXQa0',
    equipment: ['dumbbells', 'flat_bench'],
    description:
      'Lying triceps extension with dumbbells, each arm free to find a comfortable path.',
    instructions: steps(
      'Lie on a bench, dumbbells over the shoulders, palms facing each other.',
      'Lower them beside the head, arms angled slightly back toward the ears.',
      'Extend to lockout.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Cable Triceps Kickback',
    video: 'https://www.youtube.com/watch?v=q0LGf0ojb4Y',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'One-arm extension with the arm behind the torso. Hardest at lockout. Weight shown is per side.',
    instructions: steps(
      'Handle or cable end from a low pulley, hinge forward, upper arm fixed beside or slightly behind the torso.',
      'Extend slowly to a full lockout and squeeze.',
      'Return under control; it is a finesse lift, not a heavy one.',
    ),
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Reverse Wrist Curl',
    video: 'https://www.youtube.com/watch?v=YOi0x2yXryA',
    equipment: ['dumbbells'],
    description: 'Direct forearm extensor work. Useful against elbow pain from heavy gripping.',
    instructions: steps(
      'Forearm on a bench or thigh, palm down, wrist over the edge.',
      'Let the hand drop into a stretch, then raise the back of the hand.',
      'A thumbless (false) grip makes it easier to feel.',
    ),
    muscles: [['forearm_extensors', 100]],
  },
  {
    name: 'Wrist Curl',
    video: 'https://www.youtube.com/watch?v=weNYVPk3g1Y',
    equipment: ['dumbbells'],
    description: 'Direct forearm flexor work.',
    instructions: steps(
      'Forearm on a bench or thigh, palm up, wrist over the edge.',
      'Let the dumbbell roll down to the fingertips for a stretch.',
      'Curl the wrist up.',
    ),
    muscles: [['forearm_flexors', 100]],
  },

  // ---- hip abduction and glutes ----
  {
    name: 'Cable Hip Abduction',
    video: 'https://www.youtube.com/watch?v=bGlm-qTnfTI',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'Drive the leg out against the cable. Direct glute medius work for hip stability. Weight shown is per side.',
    instructions: steps(
      'Ankle strap on a low pulley, outer leg working, hold the stack for balance.',
      'Lean slightly forward and let the leg cross in front for a stretch.',
      'Drive the leg out to the side without leaning the trunk away.',
    ),
    muscles: [
      ['gluteus_medius', 80],
      ['gluteus_maximus', 20],
    ],
  },
  {
    name: 'Machine Hip Abduction',
    video: 'https://www.youtube.com/watch?v=5O_Y9l__iao',
    equipment: ['hip_abduction'],
    description: 'Seated hip abduction. Glute medius and minimus, both sides at once.',
    instructions: steps(
      'Pads on the outer knees, set to the widest stretch you can control.',
      'Lean the torso forward for more glute stretch.',
      'Push the knees out, pause, and return under control.',
    ),
    muscles: [
      ['gluteus_medius', 80],
      ['gluteus_maximus', 20],
    ],
  },
  {
    name: 'Cable Glute Kickback',
    video: 'https://www.youtube.com/watch?v=93VKi1D1IB8',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description:
      'One leg kicked back against a cable. Extra glute volume at little cost. Weight shown is per side.',
    instructions: steps(
      'Ankle strap on a low pulley, face the stack, hinge slightly and hold on.',
      'Kick the leg back and slightly out by extending the hip, not arching the back.',
      'Squeeze at the top and return to a stretch.',
    ),
    muscles: [
      ['gluteus_maximus', 80],
      ['hamstrings', 15],
      ['gluteus_medius', 5],
    ],
  },

  // ---- core ----
  {
    name: 'Plank',
    video: 'https://www.youtube.com/watch?v=s6coxb732BA',
    equipment: [],
    tracking: 'duration',
    description:
      'Hold a rigid line from heels to head. Trunk stability; hard to load, so a poor pick for growing the abs.',
    instructions: steps(
      'Forearms under the shoulders, body straight from heels to head.',
      'Brace the abs and squeeze the glutes; do not let the hips sag.',
      'Start with 10–15 s holds. Once several 30 s holds or one past 60 s are easy, make it harder rather than longer: elbows forward under the eyes, pelvis tucked under, everything squeezed. 30 s of that is a lot.',
    ),
    muscles: [
      ['transverse_abdominis', 40],
      ['rectus_abdominis', 30],
      ['obliques', 20],
      ['erector_spinae', 10],
    ],
  },
  {
    name: 'Side Plank',
    video: 'https://www.youtube.com/watch?v=Zu4so2D2atM',
    equipment: [],
    tracking: 'duration',
    isUnilateral: true,
    description: 'Hold per side. Obliques and trunk stability; progress by adding time.',
    instructions: steps(
      'Forearm under the shoulder, feet stacked, body in a straight line.',
      'Push the hips up and hold; do not let them drop or rotate.',
      'Repeat on the other side.',
    ),
    muscles: [
      ['obliques', 55],
      ['transverse_abdominis', 25],
      ['quadratus_lumborum', 20],
    ],
  },
  {
    name: 'Hanging Leg Raise',
    video: 'https://www.youtube.com/watch?v=Pr1ieGZ5atk',
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description:
      'Raise the legs without swinging. A lower-ab movement; pair it with a loaded crunch. Bent knees make it easier.',
    instructions: steps(
      'Hang from the bar, arms straight and shoulders engaged; the elbows stay straight throughout.',
      'Raise the legs without swinging, and curl the pelvis up at the top so the abs, not just the hip flexors, do the work.',
      'Lower under control. Bend the knees to make it easier.',
    ),
    muscles: [
      ['rectus_abdominis', 55],
      ['hip_flexors', 30],
      ['obliques', 15],
    ],
  },
  {
    name: 'Roman Chair Leg Raise',
    video: 'https://www.youtube.com/watch?v=nBsP27-x7LU',
    equipment: ['parallel_bars'],
    tracking: 'bodyweight_reps',
    description:
      "Leg raise supported on the forearms, in a captain's chair or between dip bars. A lower-ab movement without the grip of a hanging raise.",
    instructions: steps(
      'Forearms on the pads or arms locked on the bars, back against the pad if there is one.',
      'Raise the knees or straight legs, curling the pelvis up at the top.',
      'Lower under control without swinging.',
    ),
    muscles: [
      ['rectus_abdominis', 50],
      ['hip_flexors', 35],
      ['obliques', 15],
    ],
  },
  {
    name: 'Reverse Crunch',
    video: 'https://www.youtube.com/watch?v=JBAIGjLRX40',
    equipment: [],
    tracking: 'bodyweight_reps',
    description:
      'Lying lower-ab curl: the pelvis rolls toward the ribs. Pair it with a loaded crunch.',
    instructions: steps(
      'Lie on the back, knees bent, hands by the sides or holding something behind the head.',
      'Curl the hips off the floor, rolling the pelvis toward the ribs.',
      'Lower slowly, one vertebra at a time.',
    ),
    muscles: [
      ['rectus_abdominis', 70],
      ['obliques', 15],
      ['hip_flexors', 15],
    ],
  },
  {
    name: 'Cable Crunch',
    video: 'https://www.youtube.com/watch?v=kc0PRn372lo',
    equipment: ['high_pulley'],
    description:
      'Loaded spinal flexion — an upper-ab movement that can be progressed like any lift. Round the trunk down, do not hinge at the hips.',
    instructions: steps(
      'Kneel facing a high pulley, rope held beside the head.',
      'Crunch by rounding the spine, bringing the ribs toward the pelvis.',
      'Keep the hips still and return to a stretch with the spine long.',
    ),
    muscles: [
      ['rectus_abdominis', 75],
      ['obliques', 25],
    ],
  },
  {
    name: 'Pallof Press',
    video: 'https://www.youtube.com/watch?v=Te5VAYXy0wQ',
    equipment: ['adjustable_pulley'],
    isUnilateral: true,
    description: 'Anti-rotation. Resist the pull rather than producing movement.',
    instructions: steps(
      'Stand side-on to a pulley at chest height, handle held at the chest in both hands.',
      'Press the hands straight out and hold, without letting the trunk turn.',
      'Bring them back in and repeat; then the other side.',
    ),
    muscles: [
      ['obliques', 50],
      ['transverse_abdominis', 30],
      ['rectus_abdominis', 20],
    ],
  },
  {
    name: 'Dead Bug',
    video: 'https://www.youtube.com/watch?v=GbSC02oU3To',
    equipment: [],
    tracking: 'bodyweight_reps',
    description: 'Opposite arm and leg, lower back flat throughout. Trunk control, not ab growth.',
    instructions: steps(
      'Lie on the back, arms up, hips and knees at 90°.',
      'Press the lower back into the floor and keep it there.',
      'Lower the opposite arm and leg toward the floor, return, and switch sides.',
    ),
    muscles: [
      ['transverse_abdominis', 50],
      ['rectus_abdominis', 30],
      ['hip_flexors', 20],
    ],
  },

  // ---- neck ----
  {
    name: 'Plate Neck Curl',
    video: 'https://www.youtube.com/watch?v=o78kjeBJUBQ',
    equipment: ['weight_plates', 'flat_bench'],
    description:
      'Lying face up on a bench, head off the end, a plate held on the forehead: curl the chin to the chest. The neck grows only with direct work.',
    instructions: steps(
      'Lie face up with the head off the end of the bench, a towel and plate on the forehead.',
      'Let the head drop back into a comfortable stretch.',
      'Curl the chin toward the chest, slowly. Start light: the neck is unused to direct work.',
    ),
    muscles: [['neck_flexors', 100]],
  },
  {
    name: 'Plate Neck Extension',
    video: 'https://www.youtube.com/watch?v=hYqVUHC-GhE',
    equipment: ['weight_plates', 'flat_bench'],
    description:
      'Lying face down on a bench, head off the end, a plate held on the back of the head: raise the head back.',
    instructions: steps(
      'Lie face down with the head off the end of the bench, a towel and plate on the back of the head.',
      'Let the chin drop toward the chest.',
      'Raise the head back, slowly. Start light.',
    ),
    muscles: [
      ['neck_extensors', 85],
      ['trapezius_upper', 15],
    ],
  },

  // ---- lower leg ----
  {
    name: 'Standing Calf Raise',
    video: 'https://www.youtube.com/watch?v=yYBAQGtpIyM',
    equipment: ['standing_calf_raise'],
    description:
      'Knee straight, which biases the gastrocnemius. The stretch at the bottom matters more than the height at the top; 6–12 reps suit it.',
    instructions: steps(
      'Balls of the feet on the edge, knees locked.',
      'Lower into a deep stretch and pause 1–2 s there.',
      'Roll up through the balls of the feet. Barefoot if your gym allows.',
    ),
    muscles: [
      ['gastrocnemius', 75],
      ['soleus', 25],
    ],
  },
  {
    name: 'Leg Press Calf Press',
    video: 'https://www.youtube.com/watch?v=BUSEATYDXXc',
    equipment: ['leg_press'],
    description:
      'Calf raise on the leg press, knees straight: gastrocnemius-biased, with the trunk supported. 6–12 reps suit it.',
    instructions: steps(
      'Sit in the leg press, balls of the feet on the bottom edge of the platform, knees straight but not locked hard.',
      'Let the platform push the ankles into a deep stretch and pause 1–2 s.',
      'Press through the balls of the feet. Keep the safety stops engaged.',
    ),
    muscles: [
      ['gastrocnemius', 75],
      ['soleus', 25],
    ],
  },
  {
    name: 'Seated Calf Raise',
    video: 'https://www.youtube.com/watch?v=SVmM6a0dHGU',
    equipment: ['seated_calf_raise'],
    description: 'Knee bent, which biases the soleus. 10–20 reps suit it.',
    instructions: steps(
      'Pad on the lower thighs, balls of the feet on the edge.',
      'Lower into a deep stretch and pause 1–2 s.',
      'Rise as high as you can, then lower slowly.',
    ),
    muscles: [
      ['soleus', 80],
      ['gastrocnemius', 20],
    ],
  },
  {
    name: 'Single-Leg Dumbbell Calf Raise',
    video: 'https://www.youtube.com/watch?v=1D7s-VyLq0Y',
    equipment: ['dumbbells'],
    isUnilateral: true,
    description:
      'Knee straight, which biases the gastrocnemius, one leg at a time with a dumbbell on that side: the calf raise for no calf machine. 8–15 reps suit it. Weight shown is per side.',
    instructions: steps(
      'Ball of one foot on a step or a stacked plate, the other foot hooked behind it. Free hand on a wall or rack.',
      'Knee locked, lower into a deep stretch and pause 1–2 s.',
      'Rise as high as you can, then lower slowly.',
    ),
    muscles: [
      ['gastrocnemius', 75],
      ['soleus', 25],
    ],
  },
  {
    name: 'Barbell Standing Calf Raise',
    video: 'https://www.youtube.com/watch?v=3UWi44yN-wM',
    equipment: ['barbell', 'rack'],
    description:
      'Knee straight, which biases the gastrocnemius, a barbell on the upper back taken from a rack: the heavy calf raise for no calf machine. 6–12 reps suit it.',
    instructions: steps(
      'Safety bars just below the bar. Unrack it onto the upper back, balls of the feet on a plate or a step.',
      'Knees locked, lower into a deep stretch and pause 1–2 s.',
      'Rise as high as you can without rocking, then lower slowly.',
    ),
    muscles: [
      ['gastrocnemius', 75],
      ['soleus', 25],
    ],
  },
  {
    name: 'Tibialis Raise',
    video: 'https://www.youtube.com/watch?v=UmHbtN0iFMg',
    equipment: [],
    tracking: 'bodyweight_reps',
    description: 'Dorsiflexion against a wall. Useful for knee and ankle resilience.',
    instructions: steps(
      'Back against a wall, heels a foot or so in front of it.',
      'Raise the toes as high as you can, keeping the heels down.',
      'Lower slowly. Step the feet further out to make it harder.',
    ),
    muscles: [['tibialis_anterior', 100]],
  },

  // ---- carries and conditioning ----
  {
    name: "Farmer's Carry",
    video: 'https://www.youtube.com/watch?v=8OtwXwrJizk',
    equipment: ['dumbbells'],
    tracking: 'distance_duration',
    description:
      'Walk under load with a tall trunk. Grip, traps and trunk. Record distance and time.',
    instructions: steps(
      'Pick up a heavy dumbbell in each hand, standing tall.',
      'Walk with short, quick steps, shoulders down and back.',
      'Set them down under control at the end.',
    ),
    muscles: [
      ['forearm_flexors', 30],
      ['trapezius_upper', 25],
      ['obliques', 20],
      ['erector_spinae', 15],
      ['quadratus_lumborum', 10],
    ],
  },
  {
    name: 'Dead Hang',
    video: 'https://www.youtube.com/watch?v=5FQJJvUAYx4',
    equipment: ['pull_up_bar'],
    tracking: 'duration',
    description: 'Passive hang. Grip endurance and shoulder decompression.',
    instructions: steps(
      'Overhand grip about shoulder width.',
      'Hang with the arms straight and the shoulders relaxed.',
      'Breathe and hold; progress by adding time.',
    ),
    muscles: [
      ['forearm_flexors', 50],
      ['latissimus_dorsi', 25],
      ['trapezius_lower', 15],
      ['rotator_cuff', 10],
    ],
  },
  {
    name: 'Rowing Machine',
    video: 'https://www.youtube.com/watch?v=DyVEhvBNk-E',
    equipment: ['rowing_ergometer'],
    tracking: 'distance_duration',
    description: 'Low-impact conditioning. Legs, then trunk, then arms. Record distance and time.',
    instructions: steps(
      'Feet strapped in, shins vertical at the catch.',
      'Drive with the legs first, then swing the trunk back, then pull the handle to the lower ribs.',
      'Return in reverse: arms, trunk, then legs.',
    ),
    muscles: [
      ['latissimus_dorsi', 25],
      ['quadriceps', 20],
      ['erector_spinae', 15],
      ['rhomboids', 15],
      ['biceps_brachii', 15],
      ['gluteus_maximus', 10],
    ],
  },
]
