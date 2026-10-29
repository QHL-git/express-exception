// 演示用的运单数据。真实系统里这些数据来自快递公司的轨迹接口
const shipments = {
  SF1001: {
    id: "SF1001",
    status: "运输中",
    from: "杭州",
    to: "武汉",
    updated: "2026-10-26 09:12",
    exception: "物流信息已连续 3 天未更新（延误）",
    traces: [
      { text: "包裹已到达武汉转运中心", time: "10-23 08:20" },
      { text: "包裹已从杭州发出", time: "10-22 22:05" },
      { text: "包裹已揽收", time: "10-22 14:30" },
    ],
  },
  SF1002: {
    id: "SF1002",
    status: "派送中",
    from: "广州",
    to: "武汉",
    updated: "2026-10-27 16:40",
    exception: "外包装破损，已退回站点重新打包（物品破损）",
    traces: [
      { text: "快件外包装破损，站点重新加固", time: "10-27 16:40" },
      { text: "派送员派送中", time: "10-27 09:10" },
      { text: "包裹已到达武汉网点", time: "10-26 21:30" },
    ],
  },
  SF1003: {
    id: "SF1003",
    status: "已签收",
    from: "上海",
    to: "武汉",
    updated: "2026-10-25 11:02",
    exception: null,
    traces: [
      { text: "本人签收", time: "10-25 11:02" },
      { text: "派送员派送中", time: "10-25 08:45" },
      { text: "包裹已到达武汉网点", time: "10-24 20:10" },
    ],
  },
};

module.exports = shipments;
