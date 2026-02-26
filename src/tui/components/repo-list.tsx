import React from 'react';
import { Box, Text } from 'ink';
import type { WatchedRepo } from '../../watcher/types';

interface RepoListProps {
  repos: WatchedRepo[];
}

export function RepoList({ repos }: RepoListProps) {
  return (
    <Box flexDirection="column" paddingX={1} marginTop={1}>
      <Text bold underline>
        Watching {repos.length} repo(s)
      </Text>
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        {repos.map((repo) => (
          <Text key={`${repo.project}/${repo.repoId}`} color="blue">
            {repo.project}/{repo.repoName}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
