import * as React from "react"
import { Link, graphql } from "gatsby"
import _ from "lodash"

import Bio from "../components/bio"
import Layout from "../components/layout"
import Seo from "../components/seo"

const Tags = ({ data, location, pageContext }) => {
  const siteTitle = data.site.siteMetadata?.title || `Title`
  const posts = data.allMarkdownRemark.nodes

  return (
    <Layout location={location} title={siteTitle}>
      <Seo title="Tags" />
      <Bio />
      <h1>
        {pageContext.tag} ({data.allMarkdownRemark.totalCount}件)
      </h1>
      <ol style={{ listStyle: `none` }}>
        {posts.map(post => {
          const title = post.frontmatter.title || post.fields.slug

          return (
            <li key={post.fields.slug}>
              <article
                className="post-list-item"
                itemScope
                itemType="http://schema.org/Article"
              >
                <header>
                  <h2>
                    <Link to={post.fields.slug} itemProp="url">
                      <span itemProp="headline">{title}</span>
                    </Link>
                  </h2>
                  <div className="post-date">
                    <small>{post.frontmatter.date}</small>
                  </div>
                  <div className="post-tags">
                    <small>
                        {post.frontmatter.tags.map(tag => {
                            return <span>
                                <Link to={`/tags/${_.kebabCase(tag)}/`}>
                                    {tag}
                                </Link>{` `}
                            </span>
                        })}
                    </small>
                  </div>
                </header>
                <section>
                  <p
                    dangerouslySetInnerHTML={{
                      __html: post.frontmatter.description || post.excerpt,
                    }}
                    itemProp="description"
                  />
                </section>
              </article>
            </li>
          )
        })}
      </ol>
    </Layout>
  )
}

export default Tags

export const pageQuery = graphql`
  query Tag($tag: String) {
    site {
      siteMetadata {
        title
      }
    }
    allMarkdownRemark(
        limit: 1000
        sort: { fields: [frontmatter___date], order: DESC }
        filter: { frontmatter: { tags: { in: [$tag] } } }
        ) {
      totalCount
      nodes {
        excerpt
        fields {
          slug
        }
        frontmatter {
          date(formatString: "YYYY/MM/DD")
          title
          description
          tags
        }
      }
    }
  }
`
