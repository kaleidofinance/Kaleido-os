"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import { navigationGroups } from "../landing-v2/navigation";
import styles from "./page.module.css";

export default function LandingNavV3() {
  const [open, setOpen] = useState<number | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  useEffect(() => {
    if (open === null) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) {
        setOpen(null);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <nav
      ref={navRef}
      className={styles.nav}
      aria-label="Main navigation"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || open === null) return;
        event.preventDefault();
        triggers.current[open]?.focus();
        setOpen(null);
      }}
    >
      {navigationGroups.map(({ title, links }, index) => {
        const expanded = open === index;
        const panelId = `${id}-v3-panel-${index}`;
        return (
          <div key={title} className={styles.navGroup}>
            <button
              ref={(node) => {
                triggers.current[index] = node;
              }}
              className={styles.navTrigger}
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : index)}
            >
              {title}
              <LuChevronDown aria-hidden="true" size={13} />
            </button>
            <div className={styles.navPanel} hidden={!expanded} id={panelId}>
              <ul className={styles.navCards}>
                {links.map(({ label, href, description, Icon }) => (
                  <li key={href}>
                    <a className={styles.navCard} href={href} onClick={() => setOpen(null)}>
                      <span className={styles.navIcon}>
                        <Icon size={17} aria-hidden="true" />
                      </span>
                      <span className={styles.navCardBody}>
                        <strong>{label}</strong>
                        <span className={styles.navDescription}>{description}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
