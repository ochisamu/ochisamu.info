import * as React from "react"
import { Link } from "gatsby"
import "@fontsource/noto-sans-jp"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCat } from "@fortawesome/free-solid-svg-icons"

const Layout = ({ location, title, children }) => {
  const rootPath = `${__PATH_PREFIX__}/`
  const isRootPath = location.pathname === rootPath
  let header

  header = (
    <h1 className="main-heading">
      <FontAwesomeIcon icon={faCat} />
      {` `}
      <Link to="/">{title}</Link>
    </h1>
  )

  return (
    <div className="global-wrapper" data-is-root-path={isRootPath}>
      <header className="global-header">{header}</header>
      <main>{children}</main>
      <footer>
        © {new Date().getFullYear()} ochisamu, Built with
        {` `}
        <a href="https://www.gatsbyjs.com">Gatsby</a>
      </footer>
    </div>
  )
}

export default Layout
