import EatStateScreen from '@/components/eat/EatStateScreen'

// /eat/not-found — the CD « 404 » error state. Next renders this for `notFound()` and for
// any unmatched route INSIDE the /eat segment; it renders within the EatShell layout, so
// the `.gb` token scope + Material icon font are inherited. This is a Server Component (no
// data fetch) that delegates to the shared <EatStateScreen/> presentational component; the
// "Retour à l'accueil" / "Chercher un restaurant" links (locale-aware) live in there.
export default function EatNotFound() {
  return <EatStateScreen variant="notfound" />
}
