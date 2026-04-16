import Image from "next/image"

export default function Background() {
  return (
    // <div className="fixed inset-0 -z-10">
    //   <Image src="/newbg.png" alt="background" fill priority quality={100} className="object-cover object-center" />
    // </div>

    <div className="fixed inset-0 -z-10 overflow-hidden">
      <video autoPlay loop muted playsInline className="h-full w-full object-cover object-center">
        <source src="/bggif.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
    </div>
  )
}
