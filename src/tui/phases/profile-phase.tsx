import React from "react";
import { Box, Text } from "ink";
import { SelectInput } from "../components/select-input";
import { TextInput } from "../components/text-input";
import { THEME } from "../../shared/theme";
import {
  listProfiles,
  getActiveProfile,
  createProfile,
  deleteProfile,
} from "../../cli/config-store";

interface ProfileSelectProps {
  onSelect: (profile: string) => void;
  onCreateNew: () => void;
  onBack: () => void;
}

export function ProfileSelectPhase({ onSelect, onCreateNew, onBack }: ProfileSelectProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>{'\u2630'} Select Profile</Text>
      </Box>
      <SelectInput
        items={[
          ...listProfiles().map((p) => ({
            label: p === getActiveProfile() ? `${p} (active)` : p,
            value: p,
          })),
          { label: '+ Create new profile', value: '__new__' },
        ]}
        onSelect={(item) => {
          if (item.value === '__new__') {
            onCreateNew();
          } else {
            onSelect(item.value);
          }
        }}
        onBack={onBack}
      />
    </Box>
  );
}

interface ProfileNameProps {
  command: "watch" | "review" | null;
  onCreated: (name: string) => void;
  onError: (message: string) => void;
  onBack: () => void;
}

export function ProfileNamePhase({ command, onCreated, onError, onBack }: ProfileNameProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>{'\u2630'} New Profile</Text>
      </Box>
      <TextInput
        label="Profile name"
        onBack={onBack}
        onSubmit={(name) => {
          try {
            createProfile(name);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("already exists")) {
              onCreated(name);
              return;
            }
            onError(msg);
            return;
          }
          onCreated(name);
        }}
      />
    </Box>
  );
}

interface ManageProfileProps {
  message: { text: string; color: string } | null;
  onSelect: (name: string) => void;
  onBack: () => void;
}

export function ManageProfilePhase({ message, onSelect, onBack }: ManageProfileProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={THEME.primary} bold>{'\u2630'} Manage Profiles</Text>
      </Box>
      {message && (
        <Box marginBottom={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}
      <SelectInput
        items={listProfiles().map((p) => ({
          label: p === getActiveProfile() ? `${p} (active)` : p,
          value: p,
        }))}
        onSelect={(item) => onSelect(item.value)}
        onBack={onBack}
      />
    </Box>
  );
}

interface ManageProfileActionProps {
  profileName: string;
  onEdit: (name: string) => void;
  onDelete: (name: string) => void;
  onBack: () => void;
}

export function ManageProfileActionPhase({ profileName, onEdit, onDelete, onBack }: ManageProfileActionProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} gap={1}>
        <Text color={THEME.primary} bold>{'\u2630'}</Text>
        <Text color="white" bold>{profileName}</Text>
      </Box>
      <SelectInput
        items={[
          { label: 'Edit profile', value: 'edit', icon: '\u270e', description: 'Update provider, credentials, and settings' },
          { label: 'Delete profile', value: 'delete', icon: '\u2716', description: 'Remove this profile' },
        ]}
        onSelect={(item) => {
          if (item.value === 'edit') {
            onEdit(profileName);
          } else if (item.value === 'delete') {
            onDelete(profileName);
          }
        }}
        onBack={onBack}
      />
    </Box>
  );
}
