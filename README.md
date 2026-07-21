# Bazaar Ledger (version Supabase)

Suivi de flips bazaar Hypixel Skyblock. Les données sont sauvegardées dans
une vraie base de données Supabase (Postgres), accessible depuis n'importe
quel appareil — rien n'est stocké dans le navigateur.

## 1. Créer le projet Supabase

1. Va sur https://supabase.com, crée un compte gratuit, puis "New project".
2. Une fois le projet créé, va dans **SQL Editor** (menu de gauche) et colle ceci, puis "Run" :

```sql
create table public.ledger_store (
  id integer primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.ledger_store (id, data)
values (1, '{"currentProfile": null, "profiles": [], "data": {}}'::jsonb)
on conflict (id) do nothing;

alter table public.ledger_store enable row level security;

create policy "public read" on public.ledger_store
  for select using (true);

create policy "public update" on public.ledger_store
  for update using (true) with check (true);
```

Ça crée une table avec une seule ligne (id = 1) qui contient toutes tes
données (profils, trades, historique, favoris) dans une colonne JSON.

## 2. Récupérer tes identifiants

Dans Supabase : **Project Settings** (icône engrenage) → **API**. Copie :
- **Project URL**
- **anon public** (la clé API "anon", PAS la clé "service_role")

## 3. Configurer le site

Ouvre `supabase-config.js` et remplace les deux valeurs :

```js
const SUPABASE_CONFIG = {
  url: 'https://TON-PROJET.supabase.co',
  anonKey: 'TA_CLE_ANON_PUBLIQUE'
};
```

## 4. Héberger

Comme c'est du HTML/CSS/JS pur (aucun serveur requis), tu peux héberger ça
n'importe où, y compris sur **GitHub Pages** comme avant — mets tous les
fichiers (`index.html`, `style.css`, `script.js`, `supabase-config.js`) à
la racine de ton dépôt.

## À savoir sur la sécurité

La clé "anon" est **faite pour être publique** — Supabase le dit
explicitement, ce n'est pas un mot de passe secret. La vraie protection
vient des règles **RLS (Row Level Security)** ci-dessus : elles autorisent
uniquement la lecture et la modification de la ligne existante, jamais la
création de nouvelles lignes ni la suppression. Concrètement : n'importe
qui trouvant ton URL de site pourrait voir/modifier tes données de trading
(pas de mot de passe séparé pour l'instant) — acceptable pour un outil
perso, mais dis-le-moi si tu veux qu'on ajoute une protection par mot de
passe par-dessus.

## Fichiers du projet

- `index.html` / `style.css` / `script.js` — le site
- `supabase-config.js` — tes identifiants Supabase (à remplir)
