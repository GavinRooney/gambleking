// ─── Course form scoring ────────────────────────────────────────────────────

interface CourseFormRecord {
  runs: number;
  wins: number;
  places: number;
}

/**
 * Score a horse based on its record at this specific course.
 *
 * @param courseForm — horse's record at the course from CourseForm table, or null
 * @returns 0-100 score
 */
export function scoreCourse(courseForm: CourseFormRecord | null): number {
  if (!courseForm || courseForm.runs === 0) return 40; // no course form

  if (courseForm.wins > 0) return 100;
  if (courseForm.places > 0) return 75;
  // Has run here but never placed
  return 50;
}
