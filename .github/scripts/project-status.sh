#!/usr/bin/env bash
# Moves issues in the Status column of the « École de danse — Roadmap » Project.
#
# Usage: project-status.sh <status> <issue number>...
#   status: Todo, In Progress, In Review or Done. An issue missing from the Project is added.
#
# Env: GH_TOKEN (write access to the organisation Projects + read access to the repo issues),
#      GITHUB_REPOSITORY, PROJECT_OWNER, PROJECT_NUMBER.
# Lifecycle: docs/guides/issues.md §8.
set -euo pipefail

STATUS="${1:?status expected}"
shift
[ "$#" -gt 0 ] || { echo "No issue to move."; exit 0; }

OWNER="${PROJECT_OWNER:?}"
NUMBER="${PROJECT_NUMBER:?}"
REPO_OWNER="${GITHUB_REPOSITORY%/*}"
REPO_NAME="${GITHUB_REPOSITORY#*/}"

# shellcheck disable=SC2016
project=$(gh api graphql -f owner="$OWNER" -F number="$NUMBER" -f query='
  query($owner: String!, $number: Int!) {
    organization(login: $owner) {
      projectV2(number: $number) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }')

PROJECT_ID=$(jq -r '.data.organization.projectV2.id' <<<"$project")
FIELD_ID=$(jq -r '.data.organization.projectV2.field.id' <<<"$project")
OPTION_ID=$(jq -r --arg s "$STATUS" \
  '.data.organization.projectV2.field.options[] | select(.name == $s) | .id' <<<"$project")

if [ -z "$OPTION_ID" ]; then
  echo "::error::Status \"$STATUS\" not found in the Project."
  exit 1
fi

for issue in "$@"; do
  # shellcheck disable=SC2016
  node=$(gh api graphql -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F number="$issue" -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { issue(number: $number) { id } }
    }' --jq '.data.repository.issue.id' 2>/dev/null || true)

  if [ -z "$node" ] || [ "$node" = "null" ]; then
    echo "#$issue is not an issue of this repository: skipped."
    continue
  fi

  # Idempotent: returns the existing card if the issue is already in the Project.
  # shellcheck disable=SC2016
  item=$(gh api graphql -f project="$PROJECT_ID" -f content="$node" -f query='
    mutation($project: ID!, $content: ID!) {
      addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
    }' --jq '.data.addProjectV2ItemById.item.id')

  # shellcheck disable=SC2016
  gh api graphql -f project="$PROJECT_ID" -f item="$item" -f field="$FIELD_ID" -f option="$OPTION_ID" -f query='
    mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field,
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }' >/dev/null
  echo "#$issue → $STATUS"
done
