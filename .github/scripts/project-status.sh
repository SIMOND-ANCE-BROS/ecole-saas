#!/usr/bin/env bash
# Déplace des issues dans la colonne Status du Project « École de danse — Roadmap ».
#
# Usage : project-status.sh <status> <n° d'issue>...
#   status : Todo, In Progress, In Review ou Done. Une issue absente du Project y est ajoutée.
#
# Env : GH_TOKEN (Projects de l'organisation en écriture + issues du dépôt en lecture),
#       GITHUB_REPOSITORY, PROJECT_OWNER, PROJECT_NUMBER.
# Cycle de vie : docs/guides/issues.md §8.
set -euo pipefail

STATUS="${1:?status attendu}"
shift
[ "$#" -gt 0 ] || { echo "Aucune issue à déplacer."; exit 0; }

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
  echo "::error::Statut « $STATUS » introuvable dans le Project."
  exit 1
fi

for issue in "$@"; do
  # shellcheck disable=SC2016
  node=$(gh api graphql -f owner="$REPO_OWNER" -f name="$REPO_NAME" -F number="$issue" -f query='
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { issue(number: $number) { id } }
    }' --jq '.data.repository.issue.id' 2>/dev/null || true)

  if [ -z "$node" ] || [ "$node" = "null" ]; then
    echo "#$issue n'est pas une issue de ce dépôt : ignorée."
    continue
  fi

  # Idempotent : renvoie la carte existante si l'issue est déjà dans le Project.
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
