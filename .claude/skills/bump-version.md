---
name: bump-version
description: Bump the plugin version across all files that contain it. Usage: /bump-version <new_version> [changelog_entry]
user_invocable: true
---

# Bump Version Skill

Bump the plugin version number across all required files and update changelogs.

## Arguments

The user provides:
1. `<new_version>` — The new semver version (e.g. `5.5.0`)
2. `[changelog_entry]` — (Optional) One or more changelog lines describing what changed. If not provided, ask the user what to put in the changelog.

## Steps

### 1. Validate the new version

- Parse the new version from the user's input. It must be a valid semver (X.Y.Z).
- Read `conekta_plugin.php` line 25 to get the current version.
- Confirm the new version is different from the current one.

### 2. Detect the current version string

Read line 25 of `conekta_plugin.php` and extract the current version (e.g. `5.4.11`). Use this as `OLD_VERSION` for all replacements below.

### 3. Update version in all files

Replace `OLD_VERSION` with `NEW_VERSION` in each of these locations:

| File | What to change |
|------|---------------|
| `conekta_plugin.php` (line ~25) | `public $version  = "OLD_VERSION";` → `public $version  = "NEW_VERSION";` |
| `conekta_checkout.php` (line ~7) | `Version: OLD_VERSION` → `Version: NEW_VERSION` |
| `package.json` (line ~3) | `"version": "OLD_VERSION"` → `"version": "NEW_VERSION"` |
| `readme.txt` (line ~7) | `Stable tag: OLD_VERSION` → `Stable tag: NEW_VERSION` |
| `README.md` (line ~3) | `v.OLD_VERSION` → `v.NEW_VERSION` |

After updating `package.json`, run `npm install --package-lock-only` to sync `package-lock.json`.

### 4. Update changelogs

Get today's date in `YYYY-MM-DD` format.

**CHANGELOG.md** — Prepend a new entry at the very top:
```
## [NEW_VERSION]() - YYYY-MM-DD
- <changelog entries>

```
(Keep existing entries below.)

**CHANGELOG** — Prepend a new entry at the very top:
```
NEW_VERSION, YYYY-MM-DD
-------------------------------------
- <changelog entries>

```
(Keep existing entries below.)

**readme.txt** — Add a new entry right after the `== Changelog ==` line (before the first existing `= x.y.z =` block):
```
= NEW_VERSION =
* <changelog entries>
```
(Keep existing entries below. Use `*` bullets to match the existing readme.txt style.)

### 5. Report

Show the user a summary:
- Old version → New version
- List of files modified
- The changelog entry added
- Remind the user to review the changes, commit, and tag the release (`git tag vNEW_VERSION`)
