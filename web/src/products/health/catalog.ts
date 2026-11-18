export type MetricDefinition = {
  id: string;
  label: string;
  unit: string;
  group: string;
};
export const metricDefinitions: Record<string, MetricDefinition> = {
  steps: { id: "steps", label: "Steps", unit: "steps", group: "activity" },
  distance: {
    id: "distance",
    label: "Kilometres",
    unit: "km",
    group: "activity"
  },
  weight: { id: "weight", label: "Weight", unit: "kg", group: "measurements" },
  calories: {
    id: "calories",
    label: "Calories burned",
    unit: "kcal",
    group: "activity"
  },
  workout_minutes: {
    id: "workout_minutes",
    label: "Workout time",
    unit: "min",
    group: "activity"
  },
  sleep: { id: "sleep", label: "Sleep", unit: "h", group: "sleep" },
  active_energy: {
    id: "active_energy",
    label: "Active calories",
    unit: "kcal",
    group: "activity"
  },
  heart_rate: {
    id: "heart_rate",
    label: "Average heart rate",
    unit: "bpm",
    group: "measurements"
  },
  oxygen: {
    id: "oxygen",
    label: "Blood oxygen",
    unit: "%",
    group: "measurements"
  },
  systolic: {
    id: "systolic",
    label: "Systolic pressure",
    unit: "mmHg",
    group: "measurements"
  },
  diastolic: {
    id: "diastolic",
    label: "Diastolic pressure",
    unit: "mmHg",
    group: "measurements"
  },
  glucose: {
    id: "glucose",
    label: "Blood glucose",
    unit: "mg/dL",
    group: "measurements"
  },
  body_fat: {
    id: "body_fat",
    label: "Body fat",
    unit: "%",
    group: "measurements"
  },
  bmr: {
    id: "bmr",
    label: "Basal metabolic rate",
    unit: "kcal/day",
    group: "measurements"
  },
  height: { id: "height", label: "Height", unit: "cm", group: "measurements" },
  vo2_max: {
    id: "vo2_max",
    label: "VO₂ max",
    unit: "ml/kg/min",
    group: "activity"
  },
  power: { id: "power", label: "Average power", unit: "W", group: "activity" },
  speed: {
    id: "speed",
    label: "Average speed",
    unit: "km/h",
    group: "activity"
  },
  calories_in: {
    id: "calories_in",
    label: "Food energy",
    unit: "kcal",
    group: "nutrition"
  },
  protein: { id: "protein", label: "Protein", unit: "g", group: "nutrition" },
  carbs: { id: "carbs", label: "Carbohydrates", unit: "g", group: "nutrition" },
  fat: { id: "fat", label: "Fat", unit: "g", group: "nutrition" },
  fibre: { id: "fibre", label: "Fibre", unit: "g", group: "nutrition" },
  sugar: { id: "sugar", label: "Sugar", unit: "g", group: "nutrition" },
  sodium: { id: "sodium", label: "Sodium", unit: "mg", group: "nutrition" },
  workout_hours: {
    id: "workout_hours",
    label: "Workout hours",
    unit: "h",
    group: "activity"
  }
};
export const healthViews = [
  {
    id: "overview",
    name: "Overview",
    description: "Your daily health summary",
    metrics: ["steps", "distance", "weight", "calories", "workout_hours"]
  },
  {
    id: "activity",
    name: "Activity",
    description: "Movement, energy and fitness",
    metrics: [
      "steps",
      "distance",
      "calories",
      "active_energy",
      "vo2_max",
      "power",
      "speed"
    ]
  },
  {
    id: "sleep",
    name: "Sleep",
    description: "Recorded sleep duration",
    metrics: ["sleep"]
  },
  {
    id: "vitals",
    name: "Vitals",
    description: "Heart, oxygen and blood pressure",
    metrics: ["heart_rate", "oxygen", "systolic", "diastolic", "glucose"]
  },
  {
    id: "body",
    name: "Body",
    description: "Latest body measurements",
    metrics: ["weight", "body_fat", "height", "bmr"]
  },
  {
    id: "nutrition",
    name: "Nutrition",
    description: "Logged food and nutrients",
    metrics: [
      "calories_in",
      "protein",
      "carbs",
      "fat",
      "fibre",
      "sugar",
      "sodium"
    ]
  },
  {
    id: "workouts",
    name: "Workouts",
    description: "Workout time, with a Monday-based weekly total",
    metrics: ["workout_hours"]
  }
];
