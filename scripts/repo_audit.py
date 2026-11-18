#!/usr/bin/env python3
"""
Public Repository Security, Hygiene & SEO Audit Tool
=====================================================
Automated verification for public open-source web applications.
Run locally: python3 scripts/repo_audit.py [--path /path/to/repo]
"""

import sys
import os
import re
import json
import subprocess
import argparse
from pathlib import Path
from collections import Counter

# ANSI Colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

class RepoAuditor:
    def __init__(self, root_dir: Path):
        self.root_dir = root_dir.resolve()
        self.passes = 0
        self.warnings = 0
        self.failures = 0
        self.report = []

    def log_pass(self, title: str, details: str = ""):
        self.passes += 1
        msg = f"  {GREEN}✔ [PASS]{RESET} {BOLD}{title}{RESET}"
        if details:
            msg += f" — {details}"
        self.report.append(msg)
        print(msg)

    def log_warn(self, title: str, details: str = ""):
        self.warnings += 1
        msg = f"  {YELLOW}⚠ [WARN]{RESET} {BOLD}{title}{RESET}"
        if details:
            msg += f" — {details}"
        self.report.append(msg)
        print(msg)

    def log_fail(self, title: str, details: str = ""):
        self.failures += 1
        msg = f"  {RED}✖ [FAIL]{RESET} {BOLD}{title}{RESET}"
        if details:
            msg += f" — {details}"
        self.report.append(msg)
        print(msg)

    def get_tracked_files(self):
        """Get list of files tracked by git, or fallback to walking directory."""
        try:
            res = subprocess.run(
                ["git", "ls-files"],
                cwd=self.root_dir,
                capture_output=True,
                text=True,
                check=True
            )
            files = [self.root_dir / f for f in res.stdout.strip().splitlines() if f]
            # Also include untracked if present
            untracked = subprocess.run(
                ["git", "ls-files", "--others", "--exclude-standard"],
                cwd=self.root_dir,
                capture_output=True,
                text=True
            )
            if untracked.returncode == 0:
                files.extend([self.root_dir / f for f in untracked.stdout.strip().splitlines() if f])
            return [f for f in files if f.is_file()]
        except Exception:
            # Fallback
            files = []
            for p in self.root_dir.rglob("*"):
                if p.is_file() and ".git" not in p.parts:
                    files.append(p)
            return files

    def audit_secrets_and_paths(self):
        print(f"\n{CYAN}{BOLD}1. Scanning for Secrets & Local Machine Paths...{RESET}")
        files = self.get_tracked_files()

        # Disallowed absolute path indicators
        path_regex = re.compile(r'(?:/Users/|/home/|/private/|file:///Users/|/working_dir/)')
        # Secret patterns (API tokens, private keys)
        secret_regex = re.compile(r'(?:ghp_[A-Za-z0-9_]{36}|AIza[0-9A-Za-z-_]{35}|sk-[A-Za-z0-9_-]{32,}|-----BEGIN PRIVATE KEY-----)')

        found_issues = []
        for file_path in files:
            # Skip this script itself and binary files or large media
            if file_path.name == "repo_audit.py" or file_path.suffix.lower() in [".gif", ".png", ".jpg", ".jpeg", ".ico", ".stl", ".zip"]:
                continue
            try:
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                for line_num, line in enumerate(content.splitlines(), start=1):
                    # Check paths
                    m_path = path_regex.search(line)
                    if m_path:
                        rel = file_path.relative_to(self.root_dir)
                        found_issues.append((rel, line_num, "Local filesystem path", line.strip()[:100]))
                    # Check secrets
                    m_sec = secret_regex.search(line)
                    if m_sec:
                        rel = file_path.relative_to(self.root_dir)
                        found_issues.append((rel, line_num, "High-entropy secret token", line.strip()[:100]))
            except Exception as e:
                pass

        if not found_issues:
            self.log_pass("No secrets or local absolute machine paths detected", f"Scanned {len(files)} files")
        else:
            for rel, line_num, kind, snippet in found_issues:
                self.log_fail(f"{kind} in {rel}:{line_num}", snippet)

    def audit_gitignore(self):
        print(f"\n{CYAN}{BOLD}2. Validating .gitignore Rules...{RESET}")
        gitignore_path = self.root_dir / ".gitignore"
        if not gitignore_path.exists():
            self.log_fail("Missing .gitignore file at repository root")
            return

        content = gitignore_path.read_text(encoding="utf-8")
        patterns_to_check = [".DS_Store", "node_modules/", ".env*", "*.log", "dist/"]
        missing = []
        for pat in patterns_to_check:
            # Check if present in content
            if not any(line.strip().startswith(pat) or line.strip() == pat for line in content.splitlines()):
                missing.append(pat)

        if not missing:
            self.log_pass(".gitignore contains all required security exclusions", ", ".join(patterns_to_check))
        else:
            self.log_warn(".gitignore missing recommended patterns", ", ".join(missing))

    def audit_root_files(self):
        print(f"\n{CYAN}{BOLD}3. Checking Required Repository & Crawler Files...{RESET}")
        required_files = {
            "LICENSE": "Open source license (MIT/Apache)",
            "README.md": "Project documentation & run guide",
            "robots.txt": "Search engine crawler policy",
            "sitemap.xml": "Canonical sitemap index",
            "llms.txt": "AI agent documentation manifest (llmstxt.org)"
        }

        for fname, desc in required_files.items():
            fpath = self.root_dir / fname
            if fpath.exists():
                size = fpath.stat().st_size
                self.log_pass(f"{fname} present", f"{desc} ({size} bytes)")
            else:
                self.log_fail(f"Missing {fname}", desc)

        # Confirm internal-only documents are not tracked in public repository
        tracked_names = [f.name for f in self.get_tracked_files()]
        internal_docs = [
            "HANDOVER_SPEC.md",
            "MODEL_GUIDES_AND_GAPS.md",
            "DESIGN_GUARDRAILS.md",
            "SPRINT2_ROADMAP.md",
            "BUILD_ROADMAP.md",
            "KERNEL_ARCHITECTURE_SPEC.md",
            "SLICER_GUARDRAILS_SPEC.md",
            "UX_ARCHITECTURE_SPEC.md",
            "AGENTS.md",
            "RELEASE_MARKETING_KIT.md"
        ]
        untracked_count = 0
        for idoc in internal_docs:
            if idoc in tracked_names:
                self.log_fail(f"Internal document {idoc} must NOT be committed to public repository")
            else:
                untracked_count += 1
        if untracked_count == len(internal_docs):
            self.log_pass(f"All {len(internal_docs)} internal engineering & model guides excluded from git repository")

    def audit_index_html(self):
        print(f"\n{CYAN}{BOLD}4. Auditing index.html (Security, SEO & DOM Structure)...{RESET}")
        index_path = self.root_dir / "index.html"
        if not index_path.exists():
            self.log_fail("Missing index.html")
            return

        html = index_path.read_text(encoding="utf-8")

        # 4.1 Check Title and Meta Description
        title_m = re.search(r'<title>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
        if title_m and len(title_m.group(1).strip()) > 10:
            self.log_pass("Page <title> verified", title_m.group(1).strip()[:60] + "...")
        else:
            self.log_fail("Missing or short <title>")

        desc_m = re.search(r'<meta\s+name=[\"\']description[\"\']\s+content=[\"\']([^\"\']+)[\"\']', html, re.IGNORECASE)
        if desc_m and len(desc_m.group(1).strip()) > 30:
            self.log_pass("Meta description verified", desc_m.group(1).strip()[:60] + "...")
        else:
            self.log_fail("Missing or inadequate meta description")

        # 4.2 Check Canonical and OpenGraph
        if 'rel="canonical"' in html or "rel='canonical'" in html:
            self.log_pass("Canonical URL link tag present")
        else:
            self.log_fail("Missing canonical link tag")

        if 'property="og:title"' in html and 'property="og:image"' in html:
            self.log_pass("OpenGraph metadata tags present")
        else:
            self.log_fail("Missing OpenGraph metadata tags")

        # 4.3 Check Schema.org JSON-LD
        jsonld_m = re.search(r'<script type=[\"\']application/ld\+json[\"\']>(.*?)</script>', html, re.IGNORECASE | re.DOTALL)
        if jsonld_m:
            try:
                data = json.loads(jsonld_m.group(1))
                if data.get("@type") == "WebApplication":
                    self.log_pass("Valid Schema.org WebApplication JSON-LD", f"Name: {data.get('name')}")
                else:
                    self.log_warn("Schema.org JSON-LD present but not WebApplication")
            except Exception as e:
                self.log_fail("Schema.org JSON-LD parsing error", str(e))
        else:
            self.log_fail("Missing Schema.org JSON-LD metadata block")

        # 4.4 Check Security Hardening: eval, innerHTML, localStorage
        if re.search(r'\beval\(', html):
            self.log_fail("Unsafe eval() invocation detected in index.html")
        else:
            self.log_pass("Zero eval() calls detected")

        if "innerHTML" in html:
            self.log_warn("innerHTML usage detected — verify string sanitization")
        else:
            self.log_pass("Zero innerHTML calls detected")

        # 4.5 Pinned CDN scripts
        cdn_scripts = re.findall(r'<script\s+[^>]*src=[\"\']([^\"\']+)[\"\'][^>]*>', html, re.IGNORECASE)
        for s in cdn_scripts:
            if s.startswith("http://"):
                self.log_fail("Insecure HTTP script import", s)
            elif s.startswith("https://"):
                self.log_pass("Secure pinned HTTPS CDN script", s)

        # 4.6 Check for duplicate DOM IDs
        dom_ids = re.findall(r'id=[\"\']([^\"\']+)[\"\']', html)
        counts = Counter(dom_ids)
        dups = {k: v for k, v in counts.items() if v > 1}
        if dups:
            self.log_fail("Duplicate DOM element IDs found", str(dups))
        else:
            self.log_pass("All DOM element IDs are unique", f"{len(dom_ids)} IDs verified")

        # 4.7 Verify document.getElementById targets exist
        get_ids = set(re.findall(r'document\.getElementById\([\'\"]([^\'\"]+)[\'\"]\)', html))
        defined_ids = set(dom_ids)
        missing_ids = get_ids - defined_ids
        if missing_ids:
            self.log_fail("Missing getElementById targets in DOM", ", ".join(missing_ids))
        else:
            self.log_pass("All document.getElementById targets exist in DOM", f"{len(get_ids)} targets verified")

    def run(self):
        print(f"{BOLD}=== SKETCH3D / Public Repository Hygiene & Security Audit ==={RESET}")
        print(f"Target Directory: {self.root_dir}\n")

        self.audit_secrets_and_paths()
        self.audit_gitignore()
        self.audit_root_files()
        self.audit_index_html()

        print(f"\n{BOLD}=== Audit Summary ==={RESET}")
        print(f"Passed:   {GREEN}{self.passes}{RESET}")
        print(f"Warnings: {YELLOW}{self.warnings}{RESET}")
        print(f"Failures: {RED}{self.failures}{RESET}\n")

        if self.failures > 0:
            print(f"{RED}{BOLD}Audit FAILED with {self.failures} issue(s).{RESET}")
            return False
        else:
            print(f"{GREEN}{BOLD}Audit PASSED successfully! All checks verified.{RESET}")
            return True


def main():
    parser = argparse.ArgumentParser(description="Repository Security, Hygiene & SEO Auditor")
    parser.add_argument("--path", default=".", help="Root directory of the repository to audit")
    args = parser.parse_args()

    auditor = RepoAuditor(Path(args.path))
    success = auditor.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
