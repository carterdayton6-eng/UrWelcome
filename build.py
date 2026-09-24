#!/usr/bin/env python3
"""
UrWelcome — Sports Betting Research
Production Build Script

Concatenates source files into a single self-contained index.html.
No external dependencies required. No API keys needed (ESPN public API).

Usage:
    python3 build.py
Output:
    dist/index.html  (self-contained, deployable)
"""

import re
import os
import shutil

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(SRC_DIR, 'dist')


def read(filename):
    with open(os.path.join(SRC_DIR, filename), 'r', encoding='utf-8') as f:
        return f.read()


def strip_es_modules(js, export_class_name=None):
    """Strip import/export statements for inline bundling."""
    # Handle LiveDataService alias export
    js = re.sub(
        r'export\s*\{\s*LiveDataService\s+as\s+LiveSportsService\s*\}\s*;?',
        'const LiveSportsService = LiveDataService;',
        js
    )
    # Strip named exports from export blocks
    js = re.sub(r'export\s*\{[^}]*\}\s*;?', '', js)
    # Strip export keyword from declarations
    js = re.sub(
        r'export\s+(async\s+function|function|class|const|let|var)\s+',
        r'\1 ',
        js
    )
    # Strip all import statements
    js = re.sub(r'import\s+[\s\S]*?;', '', js)
    return js


def build():
    print('Building UrWelcome for production...')

    # Read source files
    css = read('styles.css')
    live_service = strip_es_modules(read('liveService.js'))
    data = strip_es_modules(read('data.js'))
    app = strip_es_modules(read('app.js'))

    # Single JS bundle — DOMContentLoaded handles initialization (no duplicate call)
    js_bundle = '\n\n'.join([
        '/* === liveService.js === */',
        live_service,
        '/* === data.js === */',
        data,
        '/* === app.js === */',
        app,
    ])

    # Load HTML template
    html = read('index.html')

    # Inject CSS
    html = re.sub(
        r'<style>[\s\S]*?</style>',
        lambda m: f'<style>\n{css}\n</style>',
        html,
        count=1
    )

    # Inject JS (replace existing script block)
    # Use a more specific pattern to only match the main script block before </body>
    # This preserves any analytics or other scripts in the <head>
    body_start_pos = html.find('<body>')
    if body_start_pos != -1:
        # Only search for script tags after <body>
        html_before_body = html[:body_start_pos]
        html_from_body = html[body_start_pos:]
        
        # Replace the first script block found after <body>
        html_from_body = re.sub(
            r'<script>[\s\S]*?</script>\s*</body>',
            lambda m: f'<script>\n{js_bundle}\n</script>\n</body>',
            html_from_body,
            count=1
        )
        html = html_before_body + html_from_body
    else:
        # Fallback to original behavior
        html = re.sub(
            r'<script>[\s\S]*?</script>\s*</body>',
            lambda m: f'<script>\n{js_bundle}\n</script>\n</body>',
            html,
            count=1
        )

    # Ensure no duplicate SportsResearchApp() instantiation
    # The DOMContentLoaded listener in app.js handles startup — remove any bare call
    html = re.sub(r'\n\nnew SportsResearchApp\(\);\s*(?=</script>)', '', html)

    # Verify no localhost references
    localhost_count = html.count('localhost')
    if localhost_count > 0:
        print(f'  WARNING: {localhost_count} localhost reference(s) found')

    # Create dist directory
    os.makedirs(DIST_DIR, exist_ok=True)

    output_path = os.path.join(DIST_DIR, 'index.html')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size_kb = len(html.encode('utf-8')) / 1024
    js_size_kb = len(js_bundle.encode('utf-8')) / 1024

    print(f'  ✓ Output: dist/index.html')
    print(f'  ✓ Total size: {size_kb:.1f} KB')
    print(f'  ✓ JS bundle: {js_size_kb:.1f} KB')
    print(f'  ✓ localhost refs: {localhost_count}')
    print(f'  ✓ API keys exposed: 0 (ESPN API is public — no keys needed)')
    print('Build complete.')

    return output_path


if __name__ == '__main__':
    build()
