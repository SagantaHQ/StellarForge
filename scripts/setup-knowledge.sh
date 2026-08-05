#!/usr/bin/env bash
#
# Soroban.Build — Knowledge Base Setup (§9.4)
#
# Clones all the skills, docs, and example repos listed in the master build
# prompt into a `knowledge/` directory. The AI agent uses these to build
# its system prompt and answer Soroban-specific questions.
#
# Run this during:
#   - Docker build (Dockerfile RUN step)
#   - Local dev setup (after scripts/setup.sh)
#   - "Update knowledge base" button in Settings (re-pulls)
#
set -euo pipefail

KNOWLEDGE_DIR="${1:-./knowledge}"

echo "============================================================"
echo "  Soroban.Build — Knowledge Base Setup"
echo "  Target: $KNOWLEDGE_DIR"
echo "============================================================"
echo ""

mkdir -p "$KNOWLEDGE_DIR"
cd "$KNOWLEDGE_DIR"

# Repos to clone (from §9.3 of the master build prompt)
REPOS=(
  # OpenZeppelin Stellar skill — the agent's primary knowledge source
  "https://github.com/OpenZeppelin/openzeppelin-skills.git skills/openzeppelin-skills"

  # Official Soroban examples — contract patterns
  "https://github.com/stellar/soroban-examples.git examples/soroban-examples"

  # Stellar dev skill
  "https://github.com/stellar/stellar-dev-skill.git skills/stellar-dev-skill"

  # Stellar build (kaankacar)
  "https://github.com/kaankacar/stellar-build.git skills/kaankacar-stellar-build"

  # Stellar MCP server (stellar-raven)
  "https://github.com/stellar-experimental/stellar-raven.git tools/stellar-raven"

  # OpenZeppelin adapters (adapter-stellar — for template UIs)
  "https://github.com/OpenZeppelin/openzeppelin-adapters.git adapters/openzeppelin-adapters"
)

for entry in "${REPOS[@]}"; do
  URL=$(echo "$entry" | awk '{print $1}')
  DIR=$(echo "$entry" | awk '{print $2}')

  if [ -d "$DIR" ]; then
    echo "🔄 Updating $DIR..."
    cd "$DIR"
    git pull --ff-only origin main 2>/dev/null || git pull --ff-only origin master 2>/dev/null || true
    cd -
  else
    echo "📥 Cloning $URL → $DIR..."
    git clone --depth 1 "$URL" "$DIR"
  fi
  echo "   ✓ $DIR"
done

echo ""
echo "============================================================"
echo "  Knowledge base contents:"
echo "============================================================"
find . -maxdepth 2 -type d | head -30

echo ""
echo "============================================================"
echo "  Reconstructing agent system prompt..."
echo "============================================================"

# Build a summary index of the knowledge base
# The AI agent's context assembler uses this to include relevant docs
INDEX_FILE="index.md"
{
  echo "# Soroban.Build Knowledge Base Index"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  for entry in "${REPOS[@]}"; do
    DIR=$(echo "$entry" | awk '{print $2}')
    if [ -d "$DIR" ]; then
      echo "## $DIR"
      echo ""
      # List top-level files and SKILL.md if present
      if [ -f "$DIR/SKILL.md" ]; then
        echo "- SKILL.md: $(head -1 "$DIR/SKILL.md" | sed 's/^# *//')"
      fi
      if [ -f "$DIR/README.md" ]; then
        echo "- README.md: $(head -1 "$DIR/README.md" | sed 's/^# *//')"
      fi
      # List subdirectories
      find "$DIR" -maxdepth 1 -type d ! -path "$DIR" ! -path "*/.git" | while read -r sub; do
        echo "- $(basename "$sub")/"
      done
      echo ""
    fi
  done
} > "$INDEX_FILE"

echo "   ✓ Index written to $INDEX_FILE"
echo ""
echo "============================================================"
echo "  ✓ Knowledge base ready!"
echo "============================================================"
echo ""
echo "  The AI agent will use this knowledge to answer Soroban-specific"
echo "  questions. Re-run this script to update (re-pulls all repos)."
echo ""
