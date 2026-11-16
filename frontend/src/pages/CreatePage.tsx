import { CreateTokenForm } from '../components/CreateTokenForm'
import { useCreatedTokens } from '../store/creations'

export function CreatePage() {
  const addCreatedToken = useCreatedTokens((state) => state.add)

  function onCreated(token: {
    id: string
    decimals: number
    symbol?: string
    name?: string
    creator?: string
  }) {
    addCreatedToken({
      id: token.id,
      symbol: token.symbol,
      name: token.name,
      creator: token.creator,
      decimals: token.decimals,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl flex items-center gap-2">
          <span>🚀</span> Launch Your Token
        </h1>
        <p className="mt-1 max-w-xl text-sm text-slate-400">
          10M fixed supply, automatic bonding curve, and 100% LP burned on graduation.
        </p>
      </div>

      <CreateTokenForm onCreated={onCreated} />
    </div>
  )
}
