"use client";

import { useActionState, useMemo, useState } from "react";
import type { InvokeType, JsonObject } from "@codexdock/sdk";
import { trackGoogleAnalyticsEvent } from "./google-analytics-events";
import { usePlaygroundRefresh } from "./playground-live-state";

export interface PlaygroundPreset {
  type: InvokeType;
  label: string;
  title: string;
  cue: string;
  prompt: string;
  parameters: JsonObject;
}

export function PlaygroundCreatePanel({
  presets,
  createInvocation,
}: {
  presets: PlaygroundPreset[];
  createInvocation: (formData: FormData) => Promise<void>;
}) {
  const firstPreset = presets[0];
  const [selectedType, setSelectedType] = useState<InvokeType>(firstPreset.type);
  const [prompt, setPrompt] = useState(firstPreset.prompt);
  const [parameters, setParameters] = useState(stringifyParameters(firstPreset.parameters));
  const refreshPlayground = usePlaygroundRefresh();
  const [, formAction, isCreating] = useActionState(
    async (submitCount: number, formData: FormData) => {
      const submittedType = String(formData.get("type") ?? selectedType);
      const submittedPrompt = String(formData.get("prompt") ?? "");
      trackGoogleAnalyticsEvent("playground_create_invocation_click", {
        click_target: "create_invocation",
        invocation_type: submittedType,
        prompt_length: submittedPrompt.trim().length,
        selected_preset: selectedPreset.title,
      });
      await createInvocation(formData);
      await refreshPlayground();
      trackGoogleAnalyticsEvent("playground_create_invocation_submitted", {
        invocation_type: submittedType,
        selected_preset: selectedPreset.title,
      });
      return submitCount + 1;
    },
    0,
  );

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.type === selectedType) ?? firstPreset,
    [firstPreset, presets, selectedType],
  );

  function applyPreset(preset: PlaygroundPreset) {
    setSelectedType(preset.type);
    setPrompt(preset.prompt);
    setParameters(stringifyParameters(preset.parameters));
    trackGoogleAnalyticsEvent("playground_select_preset_click", {
      click_target: "preset_button",
      invocation_type: preset.type,
      preset_label: preset.label,
      preset_title: preset.title,
    });
  }

  return (
    <div className="createPanel">
      <div className="presetHeader">
        <div>
          <p className="eyebrow">Presets</p>
          <h3>Starting point</h3>
        </div>
        <span>{selectedPreset.label} selected</span>
      </div>

      <div aria-label="Invocation presets" className="presetGrid" role="group">
        {presets.map((preset) => {
          const isSelected = preset.type === selectedType;

          return (
            <button
              aria-pressed={isSelected}
              className={isSelected ? "presetButton selected" : "presetButton"}
              key={preset.type}
              onClick={() => applyPreset(preset)}
              type="button"
            >
              <span>{preset.label}</span>
              <strong>{preset.title}</strong>
              <small>{preset.cue}</small>
            </button>
          );
        })}
      </div>

      <form action={formAction} className="playgroundForm">
        <div className="formHeader">
          <div>
            <p className="eyebrow">Invocation</p>
            <h3>{selectedPreset.title}</h3>
          </div>
          <CreateSubmitButton isCreating={isCreating} />
        </div>
        <p className="testHint">
          Curious how generation feels? The Text preset is the fastest smoke
          test; connect a worker and use Create to send one real job through.
        </p>
        <input name="type" type="hidden" value={selectedType} />
        <label>
          <span>Type</span>
          <select
            key={selectedType}
            onChange={(event) => {
              const nextType = event.target.value as InvokeType;
              setSelectedType(nextType);
              trackGoogleAnalyticsEvent("playground_change_invocation_type", {
                click_target: "type_select",
                invocation_type: nextType,
              });
            }}
            value={selectedType}
          >
            <option value="generate_text">generate_text</option>
            <option value="generate_image">generate_image</option>
            <option value="generate_object">generate_object</option>
            <option value="generate_file">generate_file</option>
          </select>
        </label>
        <label>
          <span>Prompt</span>
          <textarea
            name="prompt"
            onChange={(event) => setPrompt(event.target.value)}
            value={prompt}
          />
        </label>
        <label>
          <span>Parameters JSON</span>
          <textarea
            className="monoInput"
            name="parameters"
            onChange={(event) => setParameters(event.target.value)}
            value={parameters}
          />
        </label>
      </form>
    </div>
  );
}

function CreateSubmitButton({ isCreating }: { isCreating: boolean }) {
  return (
    <button disabled={isCreating} type="submit">
      {isCreating ? "Creating..." : "Create"}
    </button>
  );
}

function stringifyParameters(value: JsonObject) {
  return JSON.stringify(value, null, 2);
}
