import { Disclosure } from "./Disclosure";
import type { ViewState } from "../types";

export function Schedule({ schedule }: { schedule: ViewState["schedule"] }) {
  return (
    <section>
      <h2>Schedule</h2>
      <table>
        <thead>
          <tr>
            <th>Timer</th>
            <th>Next</th>
            <th>Last</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {schedule.featured.map((row) => (
            <tr key={row.unit}>
              <td>{row.unit}</td>
              <td>{row.next}</td>
              <td>{row.last}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Disclosure summary="Host housekeeping">
        <table>
          <thead>
            <tr>
              <th>Timer</th>
              <th>Next</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {schedule.housekeeping.map((row) => (
              <tr key={row.unit}>
                <td>{row.unit}</td>
                <td>{row.next}</td>
                <td>{row.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>
    </section>
  );
}
