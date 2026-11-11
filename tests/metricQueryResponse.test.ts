import assert from "node:assert/strict";
import test from "node:test";
import type { MetricsSeries } from "@komari/proto/komari/metrics/v1/metrics_pb";
import { mapMetricQuerySeries } from "../src/utils/metricQueryResponse.ts";

test("query mapping preserves source precision, watermarks, unknown gaps and true zero", () => {
  const timestamp = { seconds: 1794355200n, nanos: 0 };
  const series = {
    metric:"cpu",agentId:"node",labels:{device:"0"},type:"gauge",unit:"%",retentionDays:30,
    downsampled:true,aggregation:"avg",interval:{seconds:120n,nanos:0},
    requestedInterval:{seconds:120n,nanos:0},coverage:"partial",coverageStart:timestamp,
    coverageEnd:timestamp,boundaryAdjusted:true,summarizedThrough:9007199254740993n,
    acceptedThrough:9007199254740994n,
    sources:[{startTime:timestamp,endTime:timestamp,sourceInterval:{seconds:60n,nanos:0},reason:""}],
    gaps:[{startTime:timestamp,endTime:timestamp,sourceInterval:{seconds:3600n,nanos:0},reason:"precision"}],
    queryPoints:[
      {observedAt:timestamp,value:0,sampleCount:1,labels:{},sourceInterval:{seconds:60n,nanos:0},coverage:"complete",coverageReason:""},
      {observedAt:timestamp,sampleCount:0,labels:{},coverage:"unavailable",coverageReason:"precision"},
    ],
  } as unknown as MetricsSeries;
  const got=mapMetricQuerySeries(series);
  assert.deepEqual(got.points.map(p=>p.value),[0,null]);
  assert.equal(got.coverage,"partial");
  assert.equal(got.sources?.[0].source_interval_seconds,60);
  assert.equal(got.gaps?.[0].reason,"precision");
  assert.equal(got.points[1].coverage_reason,"precision");
  assert.equal(got.summarized_through,"9007199254740993");
  assert.equal(got.accepted_through,"9007199254740994");
});
