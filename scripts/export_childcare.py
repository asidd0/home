#!/usr/bin/env python3
"""Export the reviewed childcare archive without publishing local research files.

Usage: python3 scripts/export_childcare.py /path/to/childcare_repository
"""
import argparse
import json
import shutil
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()
source = args.source.resolve()
target = Path(__file__).resolve().parents[1] / 'childcare'
assert (source / 'data/article-groups.json').is_file(), 'Expected the reviewed research repository'
target.mkdir(exist_ok=True)

def write_json(name, data):
    p = target / 'data' / name
    p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')

def copy(relative):
    src = (source / relative).resolve()
    assert src.is_relative_to(source) and src.is_file(), relative
    dest = target / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)

for relative in ['index.html', 'archive.html', 'app.js', 'styles.css']:
    copy(relative)
# Make the fallback useful on the public website, without local file instructions.
p = target / 'app.js'
s = p.read_text().replace('Open this archive through its local server.<br><small>Use Start Childcare Archive.command in the project folder.</small>', 'The archive could not be loaded. Please reload the page or try again shortly.')
p.write_text(s)
# A directory URL lets every relative image, data, and reader link stay portable.
for name in ['index.html', 'archive.html']:
    p = target / name
    s = p.read_text().replace('<title>Timeline — Childcare at UCLA</title>', '<title>Childcare at UCLA</title>')
    s = s.replace('</head>', '<link rel="canonical" href="https://auyonsiddiq.com/childcare/"></head>')
    p.write_text(s)

catalog = json.loads((source / 'data/catalog.json').read_text())
fields = ['id', 'date', 'year', 'year_hint', 'title', 'author', 'type', 'genre', 'text', 'source_url']
public_entries = []
for entry in catalog['entries']:
    public = {k: entry[k] for k in fields if k in entry}
    public['crops'] = [{'file': c['file'], 'dimensions': c['dimensions']} for c in entry['crops']]
    for crop in public['crops']:
        copy(crop['file'])
    public_entries.append(public)
write_json('catalog.json', {'title': catalog['title'], 'stats': catalog['stats'], 'entries': public_entries})
grouped = json.loads((source / 'data/article-groups.json').read_text())
write_json('article-groups.json', {k: grouped[k] for k in ['articles', 'aliases', 'counts']})
copy('data/reading-text.json')
featured = json.loads((source / 'data/featured.json').read_text())
public_features = []
for feature in featured['entries']:
    public = {k: feature[k] for k in ['id', 'key_article', 'display_title', 'display_author', 'cover']}
    public['reading'] = [{'id': part['id'], 'text': part['text']} for part in feature['reading']]
    copy(feature['cover'])
    public_features.append(public)
write_json('featured.json', {'entries': public_features})
# Confirm all public reader parts, aliases and images resolve before publication.
by_id = {e['id']: e for e in public_entries}
main_ids = {g['id'] for g in grouped['articles']}
assert len(main_ids) == 233
assert sum(f['key_article'] for f in public_features) == 60
for group in grouped['articles']:
    assert all(part in by_id for part in group['parts'])
assert all(alias in by_id and main in main_ids for alias, main in grouped['aliases'].items())
for entry in public_entries:
    for crop in entry['crops']:
        assert (target / crop['file']).is_file()
print(f'Exported {len(main_ids)} listings, 60 featured articles, and {sum(len(e["crops"]) for e in public_entries)} original-resolution crops.')
print(f'Public archive: {sum(p.stat().st_size for p in target.rglob("*") if p.is_file()) / 1024**2:.1f} MiB')
