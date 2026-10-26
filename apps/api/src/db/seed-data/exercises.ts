import type { EquipmentSlug, MuscleSlug, TrackingMode } from '@cedo/contract'

/**
 * The starter library, owned by the seeded `cedo` group and readable by every user.
 *
 * Muscle loads are a percentage of total load and must sum to 100 — `seed.ts` validates every
 * entry against `ExerciseCreate` before writing, so a typo here fails the seed rather than
 * producing a silently wrong library.
 */
export interface SeedExercise {
  readonly name: string
  readonly tracking?: TrackingMode
  /** What it needs, all of it — `[]` nothing. See `describeEntry` in seed.ts. */
  readonly equipment: readonly EquipmentSlug[]
  readonly isUnilateral?: boolean
  readonly description: string
  readonly muscles: readonly (readonly [MuscleSlug, number])[]
}

export const EXERCISE_LIBRARY: readonly SeedExercise[] = [
  // ---- squat pattern ----
  {
    name: 'Barbell Back Squat',
    equipment: ['barbell', 'rack'],
    description:
      'Bar on the upper back, squat to depth and drive up. The reference lower-body lift.',
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
    equipment: ['barbell', 'rack'],
    description:
      'Bar racked on the front delts. More upright than a back squat, so more quad and trunk.',
    muscles: [
      ['quadriceps', 55],
      ['gluteus_maximus', 20],
      ['erector_spinae', 15],
      ['rectus_abdominis', 10],
    ],
  },
  {
    name: 'Bulgarian Split Squat',
    equipment: ['dumbbells', 'flat_bench'],
    isUnilateral: true,
    description: 'Rear foot elevated, one leg at a time. Weight shown is per side.',
    muscles: [
      ['quadriceps', 40],
      ['gluteus_maximus', 35],
      ['adductors', 15],
      ['hamstrings', 10],
    ],
  },
  {
    name: 'Leg Press',
    equipment: ['leg_press'],
    description: 'Machine squat pattern with the trunk supported.',
    muscles: [
      ['quadriceps', 55],
      ['gluteus_maximus', 30],
      ['hamstrings', 10],
      ['adductors', 5],
    ],
  },
  {
    name: 'Goblet Squat',
    equipment: ['dumbbells'],
    description:
      'Weight held at the chest. Self-correcting technique, good for learning the pattern.',
    muscles: [
      ['quadriceps', 45],
      ['gluteus_maximus', 30],
      ['rectus_abdominis', 15],
      ['adductors', 10],
    ],
  },
  {
    name: 'Leg Extension',
    equipment: ['leg_extension'],
    description: 'Isolated knee extension.',
    muscles: [['quadriceps', 100]],
  },

  // ---- hinge pattern ----
  {
    name: 'Conventional Deadlift',
    equipment: ['barbell'],
    description: 'Pull from the floor with a neutral spine. Loads the whole posterior chain.',
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
    equipment: ['barbell'],
    description: 'Hinge from the top with soft knees. Stop where the hamstrings run out of length.',
    muscles: [
      ['hamstrings', 45],
      ['gluteus_maximus', 30],
      ['erector_spinae', 20],
      ['forearm_flexors', 5],
    ],
  },
  {
    name: 'Hip Thrust',
    equipment: ['barbell', 'flat_bench'],
    description: 'Shoulders on a bench, drive the hips to lockout. The most direct glute loader.',
    muscles: [
      ['gluteus_maximus', 65],
      ['hamstrings', 25],
      ['quadriceps', 10],
    ],
  },
  {
    name: 'Back Extension',
    equipment: ['back_extension_bench'],
    tracking: 'bodyweight_reps',
    description: 'Hinge on a 45-degree or horizontal bench. Add a plate to progress.',
    muscles: [
      ['erector_spinae', 45],
      ['gluteus_maximus', 30],
      ['hamstrings', 25],
    ],
  },
  {
    name: 'Lying Leg Curl',
    equipment: ['lying_leg_curl'],
    description: 'Isolated knee flexion.',
    muscles: [
      ['hamstrings', 90],
      ['gastrocnemius', 10],
    ],
  },
  {
    name: 'Kettlebell Swing',
    equipment: ['kettlebells'],
    description: 'Ballistic hinge. Power from the hips, not a front raise.',
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
    equipment: ['barbell', 'rack', 'flat_bench'],
    description: 'Flat bench press with the shoulder blades retracted.',
    muscles: [
      ['pectoralis_major', 55],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Incline Dumbbell Press',
    equipment: ['dumbbells', 'incline_bench'],
    description: 'Around 30 degrees. More upper chest and front delt than flat pressing.',
    muscles: [
      ['pectoralis_major', 45],
      ['deltoid_anterior', 30],
      ['triceps_brachii', 25],
    ],
  },
  {
    name: 'Push-Up',
    equipment: [],
    tracking: 'bodyweight_reps',
    description: 'Rigid trunk, full range. Log added weight in the weight field.',
    muscles: [
      ['pectoralis_major', 50],
      ['triceps_brachii', 25],
      ['deltoid_anterior', 15],
      ['serratus_anterior', 10],
    ],
  },
  {
    name: 'Dip',
    equipment: ['parallel_bars'],
    tracking: 'bodyweight_reps',
    description: 'Lean forward for chest, stay upright for triceps. Log added weight.',
    muscles: [
      ['pectoralis_major', 40],
      ['triceps_brachii', 40],
      ['deltoid_anterior', 20],
    ],
  },
  {
    name: 'Cable Fly',
    equipment: ['cable_crossover'],
    description: 'Isolated chest adduction with tension through the full range.',
    muscles: [
      ['pectoralis_major', 85],
      ['deltoid_anterior', 15],
    ],
  },

  // ---- vertical push ----
  {
    name: 'Overhead Press',
    equipment: ['barbell', 'rack'],
    description:
      'Strict press from the shoulders. Squeeze the glutes to stop the lower back arching.',
    muscles: [
      ['deltoid_anterior', 40],
      ['triceps_brachii', 25],
      ['deltoid_lateral', 20],
      ['rectus_abdominis', 10],
      ['trapezius_upper', 5],
    ],
  },
  {
    name: 'Dumbbell Lateral Raise',
    equipment: ['dumbbells'],
    description: 'Raise to shoulder height. Light weight, no swing.',
    muscles: [
      ['deltoid_lateral', 80],
      ['deltoid_anterior', 10],
      ['trapezius_upper', 10],
    ],
  },

  // ---- vertical pull ----
  {
    name: 'Pull-Up',
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description: 'Pronated grip, chin over the bar. Log added weight in the weight field.',
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
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description: 'Supinated grip. More biceps than a pull-up.',
    muscles: [
      ['latissimus_dorsi', 40],
      ['biceps_brachii', 30],
      ['brachialis', 15],
      ['teres_major', 15],
    ],
  },
  {
    name: 'Lat Pulldown',
    equipment: ['high_pulley'],
    description: 'Scalable vertical pull. Drive the elbows down, not the hands.',
    muscles: [
      ['latissimus_dorsi', 55],
      ['biceps_brachii', 20],
      ['teres_major', 15],
      ['trapezius_lower', 10],
    ],
  },

  // ---- horizontal pull ----
  {
    name: 'Barbell Row',
    equipment: ['barbell'],
    description: 'Hinged torso, pull to the lower ribs.',
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
    equipment: ['low_pulley'],
    description: 'Chest tall, pull to the abdomen without rocking.',
    muscles: [
      ['latissimus_dorsi', 35],
      ['rhomboids', 25],
      ['trapezius_middle', 20],
      ['biceps_brachii', 20],
    ],
  },
  {
    name: 'Single-Arm Dumbbell Row',
    equipment: ['dumbbells', 'flat_bench'],
    isUnilateral: true,
    description: 'One arm supported. Weight shown is per side.',
    muscles: [
      ['latissimus_dorsi', 45],
      ['rhomboids', 20],
      ['biceps_brachii', 20],
      ['trapezius_middle', 15],
    ],
  },
  {
    name: 'Face Pull',
    equipment: ['high_pulley'],
    description:
      'Pull to the face with high elbows. The main rear-delt and shoulder-health movement.',
    muscles: [
      ['deltoid_posterior', 40],
      ['rhomboids', 25],
      ['trapezius_middle', 25],
      ['rotator_cuff', 10],
    ],
  },

  // ---- arms ----
  {
    name: 'Barbell Curl',
    equipment: ['barbell'],
    description: 'Elbows fixed at the sides.',
    muscles: [
      ['biceps_brachii', 70],
      ['brachialis', 20],
      ['brachioradialis', 10],
    ],
  },
  {
    name: 'Hammer Curl',
    equipment: ['dumbbells'],
    description: 'Neutral grip. Biases brachialis and brachioradialis over biceps.',
    muscles: [
      ['brachioradialis', 40],
      ['biceps_brachii', 35],
      ['brachialis', 25],
    ],
  },
  {
    name: 'Triceps Pushdown',
    equipment: ['high_pulley'],
    description: 'Elbows pinned, extend to lockout.',
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Skull Crusher',
    equipment: ['ez_bar', 'flat_bench'],
    description: 'Lying triceps extension. Loads the long head at length.',
    muscles: [['triceps_brachii', 100]],
  },
  {
    name: 'Reverse Wrist Curl',
    equipment: ['dumbbells'],
    description: 'Direct forearm extensor work. Useful against elbow pain from heavy gripping.',
    muscles: [['forearm_extensors', 100]],
  },
  {
    name: 'Wrist Curl',
    equipment: ['dumbbells'],
    description: 'Direct forearm flexor work.',
    muscles: [['forearm_flexors', 100]],
  },

  {
    name: 'Cable Hip Abduction',
    equipment: ['low_pulley'],
    isUnilateral: true,
    description: 'Drive the leg out against the cable. Direct glute medius work for hip stability.',
    muscles: [
      ['gluteus_medius', 80],
      ['gluteus_maximus', 20],
    ],
  },

  // ---- core ----
  {
    name: 'Plank',
    equipment: [],
    tracking: 'duration',
    description: 'Hold a rigid line from heels to head. Progress by adding time.',
    muscles: [
      ['transverse_abdominis', 40],
      ['rectus_abdominis', 30],
      ['obliques', 20],
      ['erector_spinae', 10],
    ],
  },
  {
    name: 'Side Plank',
    equipment: [],
    tracking: 'duration',
    isUnilateral: true,
    description: 'Hold per side. Progress by adding time.',
    muscles: [
      ['obliques', 55],
      ['transverse_abdominis', 25],
      ['quadratus_lumborum', 20],
    ],
  },
  {
    name: 'Hanging Leg Raise',
    equipment: ['pull_up_bar'],
    tracking: 'bodyweight_reps',
    description: 'Raise the legs without swinging. Posteriorly tilt the pelvis at the top.',
    muscles: [
      ['rectus_abdominis', 55],
      ['hip_flexors', 30],
      ['obliques', 15],
    ],
  },
  {
    name: 'Cable Crunch',
    equipment: ['high_pulley'],
    description: 'Loaded spinal flexion. Round the trunk down, do not hinge at the hips.',
    muscles: [
      ['rectus_abdominis', 75],
      ['obliques', 25],
    ],
  },
  {
    name: 'Pallof Press',
    equipment: ['adjustable_pulley'],
    isUnilateral: true,
    description: 'Anti-rotation. Resist the pull rather than producing movement.',
    muscles: [
      ['obliques', 50],
      ['transverse_abdominis', 30],
      ['rectus_abdominis', 20],
    ],
  },
  {
    name: 'Dead Bug',
    equipment: [],
    tracking: 'bodyweight_reps',
    description: 'Opposite arm and leg, lower back flat throughout.',
    muscles: [
      ['transverse_abdominis', 50],
      ['rectus_abdominis', 30],
      ['hip_flexors', 20],
    ],
  },

  // ---- neck ----
  {
    name: 'Plate Neck Curl',
    equipment: ['weight_plates', 'flat_bench'],
    description:
      'Lying face up on a bench, head off the end, a plate held on the forehead: curl the chin to the chest.',
    muscles: [['neck_flexors', 100]],
  },
  {
    name: 'Plate Neck Extension',
    equipment: ['weight_plates', 'flat_bench'],
    description:
      'Lying face down on a bench, head off the end, a plate held on the back of the head: raise the head back.',
    muscles: [
      ['neck_extensors', 85],
      ['trapezius_upper', 15],
    ],
  },

  // ---- lower leg ----
  {
    name: 'Standing Calf Raise',
    equipment: ['standing_calf_raise'],
    description: 'Knee straight, which biases the gastrocnemius.',
    muscles: [
      ['gastrocnemius', 75],
      ['soleus', 25],
    ],
  },
  {
    name: 'Seated Calf Raise',
    equipment: ['seated_calf_raise'],
    description: 'Knee bent, which biases the soleus.',
    muscles: [
      ['soleus', 80],
      ['gastrocnemius', 20],
    ],
  },
  {
    name: 'Tibialis Raise',
    equipment: [],
    tracking: 'bodyweight_reps',
    description: 'Dorsiflexion against a wall. Useful for knee and ankle resilience.',
    muscles: [['tibialis_anterior', 100]],
  },

  // ---- carries and conditioning ----
  {
    name: "Farmer's Carry",
    equipment: ['dumbbells'],
    tracking: 'distance_duration',
    description: 'Walk under load with a tall trunk. Record distance and time.',
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
    equipment: ['pull_up_bar'],
    tracking: 'duration',
    description: 'Passive hang. Grip endurance and shoulder decompression.',
    muscles: [
      ['forearm_flexors', 50],
      ['latissimus_dorsi', 25],
      ['trapezius_lower', 15],
      ['rotator_cuff', 10],
    ],
  },
  {
    name: 'Rowing Machine',
    equipment: ['rowing_ergometer'],
    tracking: 'distance_duration',
    description: 'Legs, then trunk, then arms. Record distance and time.',
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
