import React from "react";
import { SelectInput } from "../components/select-input";
import { MENU_ITEMS } from "../cli-constants";
import type { Phase } from "../cli-constants";

interface MenuPhaseProps {
  onSelect: (value: string) => void;
}

export function MenuPhase({ onSelect }: MenuPhaseProps) {
  return (
    <SelectInput
      items={MENU_ITEMS}
      onSelect={(item) => onSelect(item.value)}
    />
  );
}
