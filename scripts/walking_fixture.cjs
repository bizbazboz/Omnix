// A connected public-footway grid: real browser routing, deterministic map data.
function walkingFixture() {
  const elements = [];
  for (let y = 0; y < 31; y++)
    for (let x = 0; x < 31; x++)
      elements.push({
        type: "node",
        id: 1 + y * 31 + x,
        lat: 51.488 + y * 0.001,
        lon: -0.142 + x * 0.001
      });
  for (let y = 0; y < 31; y++)
    elements.push({
      type: "way",
      id: 10000 + y,
      nodes: Array.from({ length: 31 }, (_, x) => 1 + y * 31 + x),
      tags: { highway: "footway", name: "Test Street " + y }
    });
  for (let x = 0; x < 31; x++)
    elements.push({
      type: "way",
      id: 20000 + x,
      nodes: Array.from({ length: 31 }, (_, y) => 1 + y * 31 + x),
      tags: { highway: "footway", name: "Park Road " + x }
    });
  return { elements };
}
module.exports = { walkingFixture };
