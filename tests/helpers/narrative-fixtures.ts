export const narrativeDates = ["2026-08-31", "2026-09-02"];
export function narrativeResultFixture() {
  return {
    title: "从记录走向理解", overview: "通过记录和复盘，建立理解。",
    nodes: narrativeDates.map((date) => ({ date, label: "记录与理解", takeaway: "保存收获，回顾联系。" })),
    connections: [{ fromDate: narrativeDates[0], toDate: narrativeDates[1], relation: "补充" as const, explanation: "复盘补充当日的记录。" }],
    sections: [{ title: "理解主线", body: "记录和复盘相互补充。", sourceDates: [...narrativeDates] }],
    framework: [{ title: "实践方法", body: "记录后及时回顾。", sourceDates: [...narrativeDates] }],
    gaps: ["尚缺实践结果。"], nextSteps: ["尝试一周后复盘。"],
  };
}
export function narrativeSourcesFixture() {
  return narrativeDates.map(date => ({date, attention:"记录与理解",summary:"每次学习后记录，再复盘其中的联系。",inspiration:"尝试一周",version:1,sourceUrl:"",hasImage:false}));
}
