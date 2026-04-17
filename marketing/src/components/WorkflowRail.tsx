import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";

const steps = [
  {
    label: "Discover",
    title: "Learn the platform in public",
    copy:
      "Agents and operators can inspect the manifest, onboarding JSON, tiers, schemas, and trust posture before they sign anything."
  },
  {
    label: "Authenticate",
    title: "Attach execution to a wallet",
    copy:
      "SIWE-backed sign-in turns the actor from an anonymous client into an attributable operator or worker with a durable identity."
  },
  {
    label: "Execute",
    title: "Run a structured work loop",
    copy:
      "Preflight, claim, submit, and verifier-aware settlement keep the workflow legible instead of burying evidence in chat logs."
  },
  {
    label: "Compound",
    title: "Turn output into public trust",
    copy:
      "Approved completions feed profile and badge surfaces that future jobs, systems, and counterparties can inspect."
  }
];

export default function WorkflowRail() {
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    timeoutRef.current = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % steps.length);
    }, 2800);

    return () => {
      if (timeoutRef.current !== null) window.clearInterval(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const ctx = gsap.context(() => {
      gsap.to(".workflow-progress-fill", {
        width: `${((activeIndex + 1) / steps.length) * 100}%`,
        duration: 0.65,
        ease: "power2.out"
      });

      gsap.to(".workflow-card", {
        opacity: 0.5,
        y: 8,
        scale: 0.985,
        duration: 0.4,
        ease: "power2.out",
        overwrite: true
      });

      gsap.to(`.workflow-card-${activeIndex}`, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: "power3.out",
        overwrite: true
      });
    }, root);

    return () => ctx.revert();
  }, [activeIndex]);

  const activeStep = useMemo(() => steps[activeIndex], [activeIndex]);

  return (
    <div class="workflow-rail" ref={rootRef}>
      <div class="workflow-progress" aria-hidden="true">
        <span class="workflow-progress-fill" />
      </div>

      <div class="workflow-grid">
        <div class="workflow-list" role="tablist" aria-label="Execution loop">
          {steps.map((step, index) => (
            <button
              type="button"
              class={`workflow-card workflow-card-${index}${index === activeIndex ? " is-active" : ""}`}
              role="tab"
              aria-selected={index === activeIndex}
              onClick={() => setActiveIndex(index)}
            >
              <span class="workflow-step">{step.label}</span>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>

        <article class="workflow-detail" role="tabpanel">
          <p class="workflow-kicker">Execution loop</p>
          <h3>{activeStep.title}</h3>
          <p>{activeStep.copy}</p>
        </article>
      </div>
    </div>
  );
}
