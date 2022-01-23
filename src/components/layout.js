import * as React from "react"
//import { Link } from "gatsby"
import "@fontsource/noto-sans-jp"
import { createTheme, ThemeProvider } from '@mui/material/styles'

import Header from "../components/header"

export const theme = createTheme({
  typography: {
    fontFamily: ['Noto Sans JP', 'sans-serif'].join(','),
    //fontFamily: ['Times New Roman', 'sans-serif'].join(','),
  },
})

const Layout = ({ location, title, children}) => {
  const rootPath = `${__PATH_PREFIX__}/`
  const isRootPath = location.pathname === rootPath

  return (
    <>
    <ThemeProvider theme={theme}>
      <Header title={title} />
      <div className="global-wrapper" data-is-root-path={isRootPath}>
        <main>{children}</main>
        <footer>
          © {new Date().getFullYear()} ochisamu, Built with
          {` `}
          <a href="https://www.gatsbyjs.com">Gatsby</a>
        </footer>
      </div>
      </ThemeProvider>
    </>
  )
}

export default Layout
