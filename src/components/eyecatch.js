import React from "react"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCat, faKeyboard } from "@fortawesome/free-solid-svg-icons"
import { faReact } from "@fortawesome/free-brands-svg-icons"

const EyeCatch = ({ type, tags}) => {
    // トップページか記事ページか判定
    let className = "eyecatch"
    if (type.includes("index")) {
        className = "eyecatch-index"
    }

    // タグをみて判定
    let icon = faCat
    let bgColor = "#fce4ec"
    if (tags.includes("Gatsby")){
        icon = faReact
        bgColor = "#e7f7fe"
    }else if (tags.includes("Keyboard")){
        icon = faKeyboard
        bgColor = "#d0d4ed"
    }

    return (
        <div className={className} style={{backgroundColor: bgColor}}>
            <FontAwesomeIcon icon={icon} />
        </div>
    )
}

export default EyeCatch

