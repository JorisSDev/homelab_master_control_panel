import type { ViewState } from "../types";

export function Unfinished({ unfinished }: { unfinished: ViewState["unfinished"] }) {
  return (
    <section>
      <h2>Unfinished</h2>
      <ul>
        {unfinished.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      <table>
        <thead>
          <tr>
            <th>Guest</th>
            <th>Address</th>
            <th>Kind</th>
            <th>Last update</th>
            <th>Last scan</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {unfinished.guests.map((guest) => (
            <tr key={guest.id}>
              <td>
                {guest.id} {guest.name}
              </td>
              <td>{guest.address || "—"}</td>
              <td>{guest.kind}</td>
              <td>{guest.last_update}</td>
              <td>{guest.last_scan}</td>
              <td>
                {guest.href ? (
                  <a className="open" href={guest.href}>
                    Open
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
