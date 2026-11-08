"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import s from "./AgentModelSelector.module.css";

type Catalog = {
  models: { id: string; label: string }[];
  defaultModel?: string;
};

export default function AgentModelSelector({
  value,
  onChange,
}: {
  value?: string;
  onChange: (model: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalHost(document.getElementById("k-portal")); }, []);
  const catalog = useQuery<Catalog>({
    queryKey: ["agent-model-catalog"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/chat", { signal });
      if (!response.ok) throw new Error("Couldn't load models");
      const data = await response.json();
      return {
        models: Array.isArray(data.models) ? data.models : [],
        defaultModel: data.defaultModel,
      };
    },
    staleTime: 60_000,
  });
  const selected = catalog.data?.models.find((model) => model.id === value);
  const label = value ? (selected?.label ?? value) : "Auto";
  const choose = (model?: string) => {
    onChange(model);
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={s.trigger}
          aria-label={`Choose model: ${label}`}
          title={label}
        >
          <span>{label}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal container={portalHost}>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.modal}>
          <div className={s.head}>
            <Dialog.Title className={s.title}>Choose model</Dialog.Title>
            <Dialog.Close className={s.close} aria-label="Close model selector">
              ✕
            </Dialog.Close>
          </div>
          <Dialog.Description className={s.description}>
            Choose the model for cloud requests.
          </Dialog.Description>
          <div className={s.options} role="group" aria-label="Cloud model">
            <label className={s.option}>
              <input
                type="radio"
                name="agent-model"
                checked={!value}
                onChange={() => choose()}
              />
              <span>
                <span className={s.name}>Auto</span>
                <span className={s.detail}>
                  Server default
                  {catalog.data?.defaultModel
                    ? ` · ${catalog.data.defaultModel}`
                    : ""}
                </span>
              </span>
            </label>
            {catalog.data?.models.map((model) => (
              <label key={model.id} className={s.option}>
                <input
                  type="radio"
                  name="agent-model"
                  checked={value === model.id}
                  onChange={() => choose(model.id)}
                />
                <span>
                  <span className={s.name}>{model.label}</span>
                  <span className={s.detail}>{model.id}</span>
                </span>
              </label>
            ))}
            {catalog.isLoading && (
              <p className={s.status} role="status">
                Loading models…
              </p>
            )}
            {catalog.isError && (
              <div className={s.status} role="alert">
                Couldn't load models.{" "}
                <button type="button" onClick={() => void catalog.refetch()}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
