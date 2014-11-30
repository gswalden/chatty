angular.module('chatty')
    .directive('comments', function (RecursionHelper) {
    return {
        restrict: 'E',
        replace: true,
        templateUrl: 'comment/comments.html',
        scope: {
            posts: '=',
            author: '@'
        },
        compile: function(element) {
            return RecursionHelper.compile(element);
        },
        controller: function($scope, chattyService) {
            $scope.expandReply = function expandReply(post) {
                chattyService.expandReply(post.id);
            };

            $scope.collapseReply = function collapseReply(post) {
                delete post.viewFull;
            };
        }
    }
});