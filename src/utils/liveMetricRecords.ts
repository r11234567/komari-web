import type { Record as LiveRecord } from "../types/LiveData";
import type { MetricSeries } from "../types/metrics";

export const metricSeriesToLiveRecords = (series: MetricSeries[]): LiveRecord[] => {
  const byTime = new Map<string, LiveRecord>();
  type Device = NonNullable<LiveRecord["gpu"]>["detailed_info"][number];
  const devicesAtTime = new Map<string, Map<string, Device>>();
  const recordAt = (time: string) => {
    const existing = byTime.get(time);
    if (existing) return existing;
    const record: LiveRecord = {
      cpu: { usage: 0 },
      ram: { used: 0 },
      swap: { used: 0 },
      load: { load1: 0, load5: 0, load15: 0 },
      disk: { used: 0 },
      network: { up: 0, down: 0, totalUp: 0, totalDown: 0 },
      connections: { tcp: 0, udp: 0 },
      uptime: 0,
      process: 0,
      message: "",
      updated_at: time,
    };
    byTime.set(time, record);
    return record;
  };
  for (const item of series) {
    for (const point of item.points) {
      if (point.value == null || !point.time) continue;
      const record = recordAt(point.time);
      switch (item.metric_key) {
        case "cpu.usage": record.cpu.usage = point.value; break;
        case "memory.used": record.ram.used = point.value; break;
        case "swap.used": record.swap.used = point.value; break;
        case "load.average": record.load.load1 = point.value; break;
        case "disk.used": record.disk.used = point.value; break;
        case "net.in.rate": record.network.down = point.value; break;
        case "net.out.rate": record.network.up = point.value; break;
        case "net.total.up": record.network.totalUp = point.value; break;
        case "net.total.down": record.network.totalDown = point.value; break;
        case "process.count": record.process = point.value; break;
        case "connections.tcp": record.connections.tcp = point.value; break;
        case "connections.udp": record.connections.udp = point.value; break;
        case "gpu.usage":
          record.gpu ??= { count: 0, average_usage: 0, detailed_info: [] };
          record.gpu.average_usage = point.value;
          break;
        case "gpu.device.usage":
        case "gpu.memory.used":
        case "gpu.memory.total":
        case "gpu.temperature": {
          const deviceIndex = Number(item.tags?.device_index ?? 0);
          const deviceName = item.tags?.device_name ?? `GPU ${deviceIndex + 1}`;
          record.gpu ??= { count: 0, average_usage: 0, detailed_info: [] };
          // Model names are display labels; identical GPUs still have distinct
          // device indices. Keep all metric kinds on the same stable device.
          const deviceKey = item.tags?.device_id ?? item.tags?.device_index ?? deviceName;
          let devices = devicesAtTime.get(point.time);
          if (!devices) {
            devices = new Map();
            devicesAtTime.set(point.time, devices);
          }
          let device = devices.get(deviceKey);
          if (!device) {
            device = { name: deviceName, memory_total: 0, memory_used: 0, utilization: 0, temperature: 0 };
            devices.set(deviceKey, device);
            record.gpu.detailed_info.push(device);
            record.gpu.count = record.gpu.detailed_info.length;
          }
          switch (item.metric_key) {
            case "gpu.device.usage": device.utilization = point.value; break;
            case "gpu.memory.used": device.memory_used = point.value; break;
            case "gpu.memory.total": device.memory_total = point.value; break;
            case "gpu.temperature": device.temperature = point.value; break;
          }
          break;
        }
      }
    }
  }
  for (const [time, devices] of devicesAtTime) {
    byTime.get(time)!.gpu!.detailed_info = [...devices.entries()]
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([, device]) => device);
  }
  return [...byTime.values()].sort((left, right) =>
    left.updated_at.localeCompare(right.updated_at),
  );
};
