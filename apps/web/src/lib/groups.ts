// 工程はグループごとに並べるが、順序のロックはしない（どこからでも開ける）
export const GROUPS: { title: string; phases: string[] }[] = [
  { title: "事業", phases: ["P1", "P2"] },
  { title: "要求・設計", phases: ["P3"] },
  { title: "構築", phases: ["P4"] },
  { title: "リリース", phases: ["P5"] },
];
