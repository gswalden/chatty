import React from 'react'
import ChattyContext from './ChattyContext'
import fetchJson from '../../util/fetchJson'
import withIndicators from '../indicators/withIndicators'
import withAuth from '../auth/withAuth'

class ChattyProvider extends React.PureComponent {
    state = {
        threads: [],
        newThreads: []
    }

    componentDidMount() {
        this.mounted = true
        return this.fullReload()
    }

    async componentDidUpdate(oldProps) {
        if (oldProps.isLoggedIn !== this.props.isLoggedIn) {
            this.updateThreads(false, true, true)
        }
    }

    componentWillUnmount() {
        this.mounted = false
    }

    async fullReload() {
        const {setLoading} = this.props
        try {
            setLoading('async')

            const {eventId} = await fetchJson('getNewestEventId')
            await this.updateThreads(true, true, false)

            this.waitForEvent(eventId)
        } finally {
            setLoading(false)
        }
    }

    async updateThreads(freshThreads = false, freshMarkedPosts = false, includeNewThreads = false) {
        // fresh chatty load from server
        let {threads} = freshThreads ? await this.getChatty() : {}

        // process marked posts if needed
        let markedPosts
        if (freshMarkedPosts) markedPosts = await this.getMarkedPosts(freshMarkedPosts)

        // compile new thread state
        let maxPostIdByThread
        this.setState(oldState => {
            threads = (threads || oldState.threads)

            // only add in new threads when needed
            threads = includeNewThreads ? oldState.newThreads.concat(threads) : threads
            let newThreads = includeNewThreads ? [] : oldState.newThreads

            // if we're loading marked posts, process the data
            if (markedPosts) {
                const markedPostsById = markedPosts
                    .reduce((acc, post) => ({
                        ...acc,
                        [post.id]: post.type
                    }), {})

                // update post markings
                threads = threads
                    .map(thread => ({
                        ...thread,
                        pinned: markedPostsById[thread.threadId] === 'pinned',
                        collapsed: markedPostsById[thread.threadId] === 'collapsed'
                    }))
            }

            // order by recent activity
            maxPostIdByThread = threads
                .reduce((acc, thread) => {
                    acc[thread.threadId] = thread.posts.reduce((acc, post) => Math.max(post.id, acc), 0)
                    return acc
                }, {})

            // TODO: remove expired threads

            // sort by activity, pinned first
            threads = threads
                .sort((a, b) => maxPostIdByThread[b.threadId] - maxPostIdByThread[a.threadId])
                .sort((a, b) => b.pinned - a.pinned)

            return {threads, newThreads}
        }, async () => {
            if (markedPosts) {
                // clean up any old collapsed posts after loading, doesn't impact state
                let promises = markedPosts
                    .filter(post => !maxPostIdByThread[post.id])
                    .map(({id}) => this.markThread(id, 'unmarked', false))
                await Promise.all(promises)
            }
        })
    }

    async getMarkedPosts() {
        const {isLoggedIn, username} = this.props
        if (isLoggedIn) {
            const {markedPosts} = await fetchJson(`clientData/getMarkedPosts?username=${encodeURIComponent(username)}`)
            return markedPosts
        }
        return []
    }

    async getChatty(threadCount) {
        return await fetchJson(`getChatty${threadCount > 0 ? `?count=${threadCount}` : ''}`)
    }

    async waitForEvent(lastEventId) {
        if (this.mounted) {
            const {lastEventId: newerEventId, events, error} = await fetchJson(`waitForEvent?lastEventId=${lastEventId}`)

            if (this.mounted) {
                if (!error) {
                    events.forEach(event => this.handleEvent(event))

                    return this.waitForEvent(newerEventId)
                } else {
                    // TODO: handle eventing error
                    console.log('Error from API:waitForLastEvent call.', error)
                }
            }
        }
    }

    async handleEvent(event = {}) {
        const {eventType, eventData} = event

        if (eventType === 'newPost') {
            const {post} = eventData
            if (post.parentId) {
                const threadId = `${post.threadId}`
                const addReply = thread => {
                    if (thread.threadId === threadId) {
                        return {
                            ...thread,
                            posts: [
                                ...thread.posts,
                                post
                            ]
                        }
                    }
                    return thread
                }
                this.setState(oldState => ({
                    threads: oldState.threads.map(addReply),
                    newThreads: oldState.newThreads.map(addReply)
                }))
            } else {
                this.setState(oldState => ({
                    newThreads: [
                        ...oldState.newThreads,
                        {
                            threadId: `${post.id}`,
                            posts: [
                                post
                            ]
                        }
                    ]
                }))
            }
        } else if (eventType === 'categoryChange') {
            const {postId, category} = eventData
            const updateCategory = thread => {
                const threadContainsUpdate = thread.posts.find(post => post.id === postId)
                if (threadContainsUpdate) {
                    const posts = thread.posts
                        .map(post => {
                            if (post.id === postId) {
                                return {...post, category}
                            }
                            return post
                        })
                    return {...thread, posts}
                }
                return thread
            }

            this.setState(oldState => ({
                threads: oldState.threads.map(updateCategory),
                newThreads: oldState.newThreads.map(updateCategory)
            }))
        } else if (eventType === 'lolCountsUpdate') {
            const {updates} = eventData
            const updatedPostsById = updates
                .reduce(((acc, {postId, tag, count}) => ({
                    ...acc,
                    [postId]: {tag, count}
                })), {})
            const updateTags = thread => {
                const threadContainsUpdate = thread.posts.find(post => updatedPostsById[post.id])
                if (threadContainsUpdate) {
                    const posts = thread.posts
                        .map(post => {
                            const updated = updatedPostsById[post.id]
                            if (updated) {
                                const lols = (post.lols || [])
                                    .filter(tag => tag.tag !== updated.tag)
                                    .concat([updated])
                                return {...post, lols}
                            }
                            return post
                        })
                    return {...thread, posts}
                }
                return thread
            }

            this.setState(oldState => ({
                threads: oldState.threads.map(updateTags),
                newThreads: oldState.newThreads.map(updateTags)
            }))
        } else {
            console.debug('Unhandled event type:', event)
        }
    }

    refreshChatty = async () => {
        await this.updateThreads(false, false, true)
        window.scrollTo(0, 0)
    }

    markThread = async (postId, type, updateThreads = true) => {
        const {isLoggedIn, username} = this.props

        if (isLoggedIn) {
            await fetchJson('clientData/markPost', {
                method: 'POST',
                body: {username, postId, type}
            })
        }

        if (updateThreads) {
            this.setState(oldState => {
                const threadId = `${postId}`
                return {
                    threads: oldState.threads
                        .map(thread => {
                            if (thread.threadId === threadId) {
                                return {
                                    ...thread,
                                    pinned: type === 'pinned',
                                    collapsed: type === 'collapsed'
                                }
                            }
                            return thread
                        })
                }
            })
        }
    }

    render() {
        const contextValue = {
            ...this.state,
            refreshChatty: this.refreshChatty,
            markThread: this.markThread
        }

        return (
            <ChattyContext.Provider value={contextValue}>
                {this.props.children}
            </ChattyContext.Provider>
        )
    }
}

export default withIndicators(
    withAuth(
        ChattyProvider
    )
)
