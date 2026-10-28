export type MetricDefinition = {
  id: string;
  label: string;
  unit: string;
  group: string;
};
export const metricDefinitions: Record<string, MetricDefinition> = {
  steps: {
    id: "steps",
    label: "Steps",
    unit: "steps",
    group: "activity"
  },
  distance: {
    id: "distance",
    label: "Distance",
    unit: "km",
    group: "activity"
  },
  calories: {
    id: "calories",
    label: "Energy",
    unit: "kcal",
    group: "activity"
  },
  zone_minutes: {
    id: "zone_minutes",
    label: "Zone minutes",
    unit: "min",
    group: "activity"
  },
  sleep: {
    id: "sleep",
    label: "Sleep",
    unit: "h",
    group: "sleep"
  },
  resting_heart_rate: {
    id: "resting_heart_rate",
    label: "Resting heart rate",
    unit: "bpm",
    group: "measurements"
  },
  weight: {
    id: "weight",
    label: "Weight",
    unit: "kg",
    group: "measurements"
  },
  active_energy: {
    id: "active_energy",
    label: "Active energy",
    unit: "kcal",
    group: "activity"
  },
  floors: {
    id: "floors",
    label: "Floors climbed",
    unit: "floors",
    group: "activity"
  },
  elevation: {
    id: "elevation",
    label: "Elevation gain",
    unit: "m",
    group: "activity"
  },
  vo2_max: {
    id: "vo2_max",
    label: "VO\u2082 max",
    unit: "ml/kg/min",
    group: "activity"
  },
  hrv: {
    id: "hrv",
    label: "Heart rate variability",
    unit: "ms",
    group: "measurements"
  },
  oxygen: {
    id: "oxygen",
    label: "Blood oxygen",
    unit: "%",
    group: "measurements"
  },
  breathing: {
    id: "breathing",
    label: "Breathing rate",
    unit: "br/min",
    group: "measurements"
  },
  skin_temperature: {
    id: "skin_temperature",
    label: "Night skin temperature",
    unit: "\u00b0C",
    group: "measurements"
  },
  body_fat: {
    id: "body_fat",
    label: "Body fat",
    unit: "%",
    group: "measurements"
  },
  glucose: {
    id: "glucose",
    label: "Blood glucose",
    unit: "mg/dL",
    group: "measurements"
  },
  calories_in: {
    id: "calories_in",
    label: "Food energy",
    unit: "kcal",
    group: "nutrition"
  },
  carbs: {
    id: "carbs",
    label: "Carbohydrates",
    unit: "g",
    group: "nutrition"
  },
  fat: {
    id: "fat",
    label: "Fat",
    unit: "g",
    group: "nutrition"
  },
  water: {
    id: "water",
    label: "Water logged",
    unit: "L",
    group: "nutrition"
  },
  heart_rate: {
    id: "heart_rate",
    label: "Average heart rate",
    unit: "bpm",
    group: "measurements"
  },
  heart_rate_min: {
    id: "heart_rate_min",
    label: "Minimum heart rate",
    unit: "bpm",
    group: "measurements"
  },
  heart_rate_max: {
    id: "heart_rate_max",
    label: "Maximum heart rate",
    unit: "bpm",
    group: "measurements"
  },
  protein: {
    id: "protein",
    label: "Protein",
    unit: "g",
    group: "nutrition"
  },
  fibre: {
    id: "fibre",
    label: "Fibre",
    unit: "g",
    group: "nutrition"
  },
  sugar: {
    id: "sugar",
    label: "Sugar",
    unit: "g",
    group: "nutrition"
  },
  sodium: {
    id: "sodium",
    label: "Sodium",
    unit: "mg",
    group: "nutrition"
  },
  sleep_period: {
    id: "sleep_period",
    label: "Time in sleep period",
    unit: "h",
    group: "sleep"
  },
  sleep_awake: {
    id: "sleep_awake",
    label: "Awake during sleep",
    unit: "h",
    group: "sleep"
  },
  sleep_deep: {
    id: "sleep_deep",
    label: "Deep sleep",
    unit: "h",
    group: "sleep"
  },
  sleep_light: {
    id: "sleep_light",
    label: "Light sleep",
    unit: "h",
    group: "sleep"
  },
  sleep_rem: {
    id: "sleep_rem",
    label: "REM sleep",
    unit: "h",
    group: "sleep"
  },
  sleep_restless: {
    id: "sleep_restless",
    label: "Restless sleep",
    unit: "h",
    group: "sleep"
  },
  workouts: {
    id: "workouts",
    label: "Workouts",
    unit: "sessions",
    group: "activity"
  },
  workout_minutes: {
    id: "workout_minutes",
    label: "Workout time",
    unit: "min",
    group: "activity"
  }
};
export const healthViews = [
  {
    id: "overview",
    name: "Overview",
    description: "Your daily health summary",
    metrics: [
      "steps",
      "distance",
      "calories",
      "zone_minutes",
      "sleep",
      "resting_heart_rate",
      "weight"
    ]
  },
  {
    id: "activity",
    name: "Activity",
    description: "Movement, energy and fitness",
    metrics: [
      "steps",
      "distance",
      "active_energy",
      "calories",
      "zone_minutes",
      "floors",
      "elevation",
      "vo2_max"
    ]
  },
  {
    id: "sleep",
    name: "Sleep",
    description: "Duration and recorded sleep stages",
    metrics: [
      "sleep",
      "sleep_period",
      "sleep_deep",
      "sleep_light",
      "sleep_rem",
      "sleep_awake",
      "sleep_restless"
    ]
  },
  {
    id: "vitals",
    name: "Vitals",
    description: "Daily heart, oxygen and breathing summaries",
    metrics: [
      "resting_heart_rate",
      "heart_rate",
      "heart_rate_min",
      "heart_rate_max",
      "hrv",
      "oxygen",
      "breathing",
      "skin_temperature"
    ]
  },
  {
    id: "body",
    name: "Body",
    description: "Weight, body composition and glucose",
    metrics: ["weight", "body_fat", "glucose"]
  },
  {
    id: "nutrition",
    name: "Nutrition",
    description: "Logged food, nutrients and hydration",
    metrics: [
      "calories_in",
      "protein",
      "carbs",
      "fat",
      "fibre",
      "sugar",
      "sodium",
      "water"
    ]
  },
  {
    id: "workouts",
    name: "Workouts",
    description: "Recorded exercise sessions",
    metrics: ["workouts", "workout_minutes"]
  }
];
export function metricPath(id: string) {
  const view = healthViews.slice(1).find((view) => view.metrics.includes(id));
  return "/health" + (view ? "/" + view.id : "") + "?metric=" + id;
}
