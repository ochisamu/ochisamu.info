import React from 'react';
import { Link } from "gatsby"

import { AppBar, Toolbar, Typography, useScrollTrigger, Slide } from '@mui/material';
import PropTypes from 'prop-types';

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCat } from "@fortawesome/free-solid-svg-icons"


function HideOnScroll(props) {
    const { children, window } = props;
    // Note that you normally won't need to set the window ref as useScrollTrigger
    // will default to window.
    // This is only being set here because the demo is in an iframe.
    const trigger = useScrollTrigger({
        target: window ? window() : undefined,
    });

    return (
        <Slide appear={false} direction="down" in={!trigger}>
            {children}
        </Slide>
    );
}

HideOnScroll.propTypes = {
    children: PropTypes.element.isRequired,
    /**
     * Injected by the documentation to work in an iframe.
     * You won't need it on your project.
     */
    window: PropTypes.func,
};

const Header = ({title}) => {
    return (
        <HideOnScroll>
            <AppBar position="static" color="default">
                <Toolbar>
                    <Typography variant="h3">
                        <FontAwesomeIcon icon={faCat} />
                        {` `}
                        <Link to="/">{title}</Link>
                    </Typography>
                </Toolbar>
            </AppBar>
        </HideOnScroll>
    );
}


export default Header;