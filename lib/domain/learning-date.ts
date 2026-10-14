// All learning features use the same Beijing calendar day on clients and servers.
export function getLearningDate(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextLearningMidnight(now = new Date()) {
  return new Date(Date.parse(`${getLearningDate(now)}T16:00:00Z`)).toISOString();
}
