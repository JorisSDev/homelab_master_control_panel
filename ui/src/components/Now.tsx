import { FadeText } from "./FadeText";
import type { Now as NowState } from "../types";

export function Now({ now }: { now: NowState }) {
  return (
    <section className="now">
      <h2>Now</h2>
      {now.idle ? (
        <p>
          <FadeText text={now.text} />
        </p>
      ) : (
        <>
          {now.jobs.map((job) => (
            <p key={job.label}>
              <FadeText
                text={
                  job.elapsed
                    ? `${job.label} since ${job.since}, ${job.elapsed} elapsed.`
                    : `${job.label} since ${job.since}.`
                }
              />
            </p>
          ))}
          {now.step ? (
            <p>
              Current step: <strong>{now.step.step}</strong> on <strong>{now.step.guest}</strong>.
            </p>
          ) : null}
          {now.waiting ? <p>Waiting for the first step mark in this run.</p> : null}
          {now.lock ? <p className="quiet">{now.lock}</p> : null}
        </>
      )}
    </section>
  );
}
