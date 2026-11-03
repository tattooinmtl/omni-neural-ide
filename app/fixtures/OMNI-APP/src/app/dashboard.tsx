import { useState, useEffect } from "react";
import { fetchMetrics } from "../services/api";
import { LiveChart } from "../components/LiveChart";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchMetrics();
      if (alive) {
        setMetrics(data);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  return (
    <main className="dashboard">
      <h1>OMNI Metrics</h1>
      <LiveChart data={metrics} />
    </main>
  );
}
