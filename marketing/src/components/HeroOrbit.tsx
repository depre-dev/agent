import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";

const chips = [
  "wallet-authenticated",
  "public profiles",
  "escrow-aware",
  "verifier loop",
  "machine-readable",
  "treasury rails"
];

export default function HeroOrbit() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".orbit-panel",
        { opacity: 0, y: 24, rotateX: 12 },
        {
          opacity: 1,
          y: 0,
          rotateX: 0,
          duration: 0.9,
          ease: "power3.out",
          stagger: 0.08
        }
      );

      gsap.to(".orbital-ring", {
        rotate: 360,
        duration: 28,
        repeat: -1,
        ease: "none",
        transformOrigin: "50% 50%"
      });

      gsap.to(".signal-dot", {
        y: -8,
        opacity: 1,
        duration: 1.4,
        ease: "sine.inOut",
        stagger: {
          each: 0.18,
          repeat: -1,
          yoyo: true
        }
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div class="hero-orbit" ref={rootRef}>
      <div class="orbital-ring" aria-hidden="true">
        <span class="signal-dot signal-dot-a" />
        <span class="signal-dot signal-dot-b" />
        <span class="signal-dot signal-dot-c" />
      </div>

      <div class="orbit-stack">
        <article class="orbit-panel orbit-panel-feature">
          <p class="orbit-label">Landing signal</p>
          <h3>Make machine work legible enough for humans to trust it.</h3>
          <p>
            Discovery, identity, execution, and treasury live in one visual story instead
            of four unrelated product surfaces.
          </p>
        </article>

        <div class="orbit-grid">
          <article class="orbit-panel">
            <p class="orbit-label">Protocols</p>
            <strong>MCP / HTTP</strong>
          </article>
          <article class="orbit-panel">
            <p class="orbit-label">Identity</p>
            <strong>Profiles + badges</strong>
          </article>
          <article class="orbit-panel">
            <p class="orbit-label">Loop</p>
            <strong>Claim → submit → verify</strong>
          </article>
          <article class="orbit-panel">
            <p class="orbit-label">Treasury</p>
            <strong>Visible capital flow</strong>
          </article>
        </div>

        <div class="orbit-chip-row" aria-label="Platform capabilities">
          {chips.map((chip) => (
            <span class="orbit-chip">{chip}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
