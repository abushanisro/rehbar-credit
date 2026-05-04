import { useState } from "react";

export type ModelPreference = "gemini" | "claude";

const KEY = "rehbar_model_preference";

export function useModelPreference() {
  const [model, setModelState] = useState<ModelPreference>(
    () => (localStorage.getItem(KEY) as ModelPreference) ?? "gemini"
  );

  const setModel = (m: ModelPreference) => {
    localStorage.setItem(KEY, m);
    setModelState(m);
  };

  return { model, setModel };
}

export function getModelPreference(): ModelPreference {
  return (localStorage.getItem(KEY) as ModelPreference) ?? "gemini";
}
