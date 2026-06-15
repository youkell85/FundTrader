import { CockpitPreview } from './DesignPreview'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#030504] px-3 pb-8 pt-16 sm:px-5 lg:px-8">
      <div className="mx-auto max-w-[1540px]">
        <CockpitPreview />
      </div>
    </div>
  )
}
