angular.module('chatty')
    .service('actionService', function($q, $http, $timeout, modelService, settingsService) {
        var actionService = {};

        var lastReply;

        actionService.login = function login(username, password) {
            var deferred = $q.defer();
            settingsService.clearCredentials();

            if (username && password) {
                var params = {
                    username: username,
                    password: password
                };

                post('https://winchatty.com/v2/verifyCredentials', params)
                    .success(function(data) {
                        var result = data && data.isValid;
                        if (result) {
                            settingsService.setCredentials(params);
                        }
                        deferred.resolve(result);
                    }).error(function() {
                        deferred.resolve(false);
                    });
            } else {
                deferred.resolve(false);
            }

            return deferred.promise;
        };

        actionService.logout = function logout() {
            settingsService.clearCredentials();

            //close reply boxes
            var threads = modelService.getThreads();
            _.each(threads, actionService.closeReplyBox);
        };

        actionService.submitPost = function submitPost(id, body) {
            var deferred = $q.defer();

            if (settingsService.isLoggedIn()) {
                var params = {
                    username: settingsService.getUsername(),
                    password: settingsService.getPassword(),
                    parentId: id,
                    text: body
                };

                post('https://winchatty.com/v2/postComment', params)
                    .success(function(data) {
                        deferred.resolve(data.result && data.result == 'success');
                    }).error(function() {
                        deferred.resolve(false);
                    });
            } else {
                deferred.resolve(false);
            }

            return deferred.promise;
        };

        actionService.collapseThread = function collapseThread(thread) {
            var threads = modelService.getThreads();
            _.pull(threads, thread);

            //collapse thread
            actionService.closeReplyBox(thread);
            thread.collapsed = true;
            delete thread.autoRefresh;
            delete thread.truncated;

            //add to the end of the list
            threads.push(thread);

            //update local storage
            settingsService.addCollapsed(thread.id);
        };

        actionService.expandThread = function expandThread(thread) {
            thread.autoRefresh = true;
            while (thread.newPosts.length) {
                var post = thread.newPosts.shift();
                var parent = modelService.getPost(post.parentId);
                parent.posts.push(post);
            }

            if (thread.truncated) {
                delete thread.truncated;
            }

            if (thread.collapsed) {
                delete thread.collapsed;

                //update local storage
                settingsService.removeCollapsed(thread.id);
            }
        };

        actionService.expandReply = function expandReply(post) {
            var thread = modelService.getPost(post.threadId);
            if (thread.truncated) {
                actionService.expandThread(thread);
            }
            if (thread.currentComment) {
                //unset previous reply
                delete thread.currentComment.viewFull;
                actionService.closeReplyBox(thread);
            }

            thread.autoRefresh = true;
            thread.currentComment = post;
            lastReply = post;
            post.viewFull = true;
        };

        actionService.previousReply = function previousReply() {
            if (lastReply) {
                var parent = modelService.getPost(lastReply.parentId);
                if (parent) {
                    var index = parent.posts.indexOf(lastReply);
                    if (index === 0 && parent.parentId > 0) {
                        actionService.expandReply(parent);
                    } else if (index > 0) {
                        var next = parent.posts[index - 1];
                        var last = findLastReply(next);
                        actionService.expandReply(last);
                    }
                }
            }
        };

        function findLastReply(post) {
            if (post.posts.length) {
                return findLastReply(_.last(post.posts));
            } else {
                return post;
            }
        }

        actionService.nextReply = function nextReply() {
            if (lastReply) {
                processNextReply(lastReply);
            }
        };

        function processNextReply(post, skipChildren) {
            if (!skipChildren && post.posts.length) {
                actionService.expandReply(post.posts[0]);
            } else {
                var parent = modelService.getPost(post.parentId);
                if (parent) {
                    var index = parent.posts.indexOf(post);
                    if (index + 1 < parent.posts.length) {
                        var next = parent.posts[index + 1];
                        actionService.expandReply(next);
                    } else {
                        processNextReply(parent, true);
                    }
                }
            }
        }

        actionService.collapseReply = function collapseReply(post) {
            if (post) {
                var parent = modelService.getPost(post.threadId);
                delete parent.currentComment;

                delete post.viewFull;
                delete post.replying;
            } else if (lastReply) {
                actionService.collapseReply(lastReply);
                lastReply = null;
            }

        };

        actionService.openReplyBox = function openReplyBox(post) {
            if (post.truncated) {
                actionService.expandThread(post);
            }

            var thread = modelService.getPostThread(post);

            //close previous reply window
            if (thread.replyingToPost) {
                delete thread.replyingToPost.replying;
            }

            thread.replyingToPost = post;
            post.replying = true;
        };

        actionService.closeReplyBox = function closeReplyBox(post) {
            var thread = modelService.getPostThread(post);
            if (thread.replyingToPost) {
                delete thread.replyingToPost.replying;
                delete thread.replyingToPost;
            }
        };

        actionService.expandNewThreads = function expandNewThreads() {
            var newThreads = modelService.getNewThreads();
            var threads = modelService.getThreads();

            while (newThreads.length) {
                threads.unshift(newThreads.pop());
            }
        };

        function post(url, params) {
            var data = _.reduce(params, function(result, value, key) {
                return result + (result.length > 0 ? '&' : '') + key + '=' + encodeURIComponent(value);
            }, '');

            var config = {
                method: 'POST',
                url: url,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                data: data
            };

            return $http(config);
        }

        return actionService;
    });